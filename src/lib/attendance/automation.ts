// Atendimento automático (migration 070). Módulo opcional: tudo desligado
// até a empresa ligar em Configurações > Atendimento. Não substitui fluxos,
// automações nem o agente de IA; no recebimento, um fluxo ativo tem
// prioridade e o menu de setores vem antes da IA.

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { engineSendText } from "@/lib/automations/meta-send";
import { getConnectionForConversation } from "@/lib/whatsapp/connections";
import {
  buildMenu,
  isOpenNow,
  parseAutomation,
  parseMenuChoice,
  parseRating,
  renderText,
  type AutomationConfig,
  type Schedule,
} from "./automation-config";

export * from "./automation-config";


// ------------------------------------------------------------
// Server side (service role)
// ------------------------------------------------------------

async function loadConfig(db: SupabaseClient, accountId: string): Promise<AutomationConfig | null> {
  const { data } = await db.from("accounts").select("attendance_automation").eq("id", accountId).maybeSingle();
  const raw = data?.attendance_automation as Record<string, unknown> | null;
  if (!raw || Object.keys(raw).length === 0) return null;
  return parseAutomation(raw);
}

/** Official API only accepts free text within 24 h of the customer's last message. */
async function canSendFreeText(db: SupabaseClient, accountId: string, conversationId: string): Promise<boolean> {
  const conn = await getConnectionForConversation(db, accountId, conversationId);
  if (!conn || conn.provider === "evolution") return true;
  const { data } = await db.from("conversations").select("last_inbound_at").eq("id", conversationId).maybeSingle();
  const last = data?.last_inbound_at ? new Date(data.last_inbound_at).getTime() : 0;
  return Date.now() - last < 24 * 3600_000;
}

async function ownerOf(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data } = await db.from("accounts").select("owner_user_id").eq("id", accountId).maybeSingle();
  return (data?.owner_user_id as string) ?? null;
}

interface InboundArgs {
  accountId: string;
  conversationId: string;
  contactId: string;
  userId: string;
  text: string;
}

/**
 * Nota de avaliação: roda ANTES da reabertura automática. Uma resposta de 1
 * a 5 dentro de 24 h do pedido é gravada no ticket e não reabre a conversa.
 * Devolve true quando consumiu a mensagem.
 */
export async function captureRating(args: InboundArgs): Promise<boolean> {
  try {
    const db = supabaseAdmin();
    const rating = parseRating(args.text);
    if (rating == null) return false;
    const { data: conv } = await db
      .from("conversations")
      .select("status, current_ticket_id")
      .eq("id", args.conversationId)
      .maybeSingle();
    if (!conv || conv.status !== "closed" || !conv.current_ticket_id) return false;
    const { data: updated } = await db
      .from("tickets")
      .update({ rating })
      .eq("id", conv.current_ticket_id)
      .is("rating", null)
      .gt("rating_requested_at", new Date(Date.now() - 24 * 3600_000).toISOString())
      .select("id");
    if (!updated || updated.length === 0) return false;
    await db.from("ticket_events").insert({ ticket_id: conv.current_ticket_id, type: "rated" });
    const cfg = await loadConfig(db, args.accountId);
    if (cfg?.rating_thanks) {
      await engineSendText({ ...args, text: cfg.rating_thanks }).catch(() => undefined);
    }
    return true;
  } catch (err) {
    console.error("[attendance] captureRating failed:", err);
    return false;
  }
}

/**
 * Menu de setores e mensagem de fora de horário. Só para atendimento que
 * o cliente começou e que ainda não tem responsável. Devolve true quando
 * consumiu a mensagem (a IA e as automações de conteúdo não respondem).
 */
export async function runTriage(args: InboundArgs): Promise<boolean> {
  try {
    const db = supabaseAdmin();
    const cfg = await loadConfig(db, args.accountId);
    if (!cfg || (!cfg.menu_enabled && !cfg.out_of_hours_enabled)) return false;

    const { data: conv } = await db
      .from("conversations")
      .select("status, assigned_agent_id, department_id, current_ticket_id, ticket_number, contact:contacts(name)")
      .eq("id", args.conversationId)
      .maybeSingle();
    if (!conv || conv.status === "closed" || conv.assigned_agent_id || !conv.current_ticket_id) return false;
    const { data: ticket } = await db
      .from("tickets")
      .select("id, opened_at, triage_status, triage_attempts, out_of_hours_sent")
      .eq("id", conv.current_ticket_id)
      .maybeSingle();
    if (!ticket) return false;
    const contactName = (conv.contact as { name?: string } | null)?.name ?? "";
    const vars = { nome: contactName, ticket: conv.ticket_number as number | null };
    const send = (text: string) => engineSendText({ ...args, text: renderText(text, vars) });

    const { data: depts } = await db
      .from("departments")
      .select("id, name, greeting_message, out_of_hours_message, schedule, is_default")
      .eq("account_id", args.accountId)
      .order("created_at");
    const list = depts ?? [];

    let deptId = conv.department_id as string | null;
    let consumed = false;

    if (cfg.menu_enabled && list.length > 1 && ticket.triage_status !== "done") {
      if (ticket.triage_status == null) {
        // atendimento iniciado por nós (campanha, nova conversa) ou já em conversa: sem menu
        const { count } = await db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", args.conversationId)
          .in("sender_type", ["agent", "bot"])
          .gte("created_at", ticket.opened_at);
        if ((count ?? 0) > 0) {
          await db.from("tickets").update({ triage_status: "done" }).eq("id", ticket.id);
        } else {
          await send(buildMenu(cfg.menu_greeting, list.map((d) => d.name)));
          await db.from("tickets").update({ triage_status: "asked" }).eq("id", ticket.id);
          return true;
        }
      } else {
        const idx = parseMenuChoice(args.text, list.length);
        if (idx == null && ticket.triage_attempts < cfg.menu_invalid_attempts) {
          await db.from("tickets").update({ triage_attempts: ticket.triage_attempts + 1 }).eq("id", ticket.id);
          await send(`Opção inválida.\n\n${buildMenu(cfg.menu_greeting, list.map((d) => d.name))}`);
          return true;
        }
        const chosen = idx == null ? (list.find((d) => d.is_default) ?? list[0]) : list[idx];
        deptId = chosen.id;
        await db.from("conversations").update({ department_id: chosen.id }).eq("id", args.conversationId);
        await db.from("tickets").update({ triage_status: "done" }).eq("id", ticket.id);
        if (chosen.greeting_message) await send(renderText(chosen.greeting_message, { ...vars, setor: chosen.name }));
        consumed = true;
      }
    }

    // Fora do horário do setor: avisa uma vez por atendimento (não consome).
    if (cfg.out_of_hours_enabled && !ticket.out_of_hours_sent) {
      const dept = list.find((d) => d.id === deptId);
      if (dept && dept.out_of_hours_message && !isOpenNow(dept.schedule as Schedule, cfg.timezone)) {
        await send(renderText(dept.out_of_hours_message, { ...vars, setor: dept.name }));
        await db.from("tickets").update({ out_of_hours_sent: true }).eq("id", ticket.id);
      }
    }
    return consumed;
  } catch (err) {
    console.error("[attendance] runTriage failed:", err);
    return false;
  }
}

/** Envia a fila de saída (de uma conta ou de todas). Nunca reenviar: falha fica registrada. */
export async function drainOutbox(accountId: string | null): Promise<number> {
  const db = supabaseAdmin();
  const { data: rows } = await db.rpc("claim_attendance_outbox", { p_account: accountId, p_limit: 20 });
  let sent = 0;
  for (const row of (rows ?? []) as {
    id: string;
    account_id: string;
    conversation_id: string;
    body: string;
  }[]) {
    try {
      if (!(await canSendFreeText(db, row.account_id, row.conversation_id))) {
        await db.from("attendance_outbox").update({ error: "window_closed" }).eq("id", row.id);
        continue;
      }
      const { data: conv } = await db.from("conversations").select("contact_id").eq("id", row.conversation_id).maybeSingle();
      const userId = await ownerOf(db, row.account_id);
      if (!conv || !userId) throw new Error("conversation_or_owner_missing");
      await engineSendText({
        accountId: row.account_id,
        userId,
        conversationId: row.conversation_id,
        contactId: conv.contact_id,
        text: row.body,
      });
      await db.from("attendance_outbox").update({ sent_at: new Date().toISOString() }).eq("id", row.id);
      sent++;
    } catch (err) {
      await db
        .from("attendance_outbox")
        .update({ error: err instanceof Error ? err.message.slice(0, 300) : "send_failed" })
        .eq("id", row.id);
    }
  }
  return sent;
}

/** Tarefas por minuto: fila de saída, transferência automática e encerramento por inatividade. */
export async function runAttendanceCron(): Promise<{ sent: number; transferred: number; closed: number }> {
  const db = supabaseAdmin();
  const sent = await drainOutbox(null);
  let transferred = 0;
  let closed = 0;

  // shortcut: lê todas as contas e filtra aqui; trocar por índice/consulta no banco com milhares de contas
  const { data: allAccounts } = await db.from("accounts").select("id, attendance_automation");
  const accounts = (allAccounts ?? []).filter(
    (a) => a.attendance_automation && Object.keys(a.attendance_automation as object).length > 0,
  );
  for (const acc of accounts) {
    const cfg = parseAutomation(acc.attendance_automation as Record<string, unknown>);

    if (cfg.auto_transfer_enabled && cfg.auto_transfer_department_id && cfg.auto_transfer_minutes > 0) {
      const { data: due } = await db
        .from("tickets")
        .select("id, conversation_id, department_id")
        .eq("account_id", acc.id)
        .is("closed_at", null)
        .is("assigned_agent_id", null)
        .eq("auto_transferred", false)
        .neq("department_id", cfg.auto_transfer_department_id)
        .lt("opened_at", new Date(Date.now() - cfg.auto_transfer_minutes * 60_000).toISOString())
        .limit(50);
      for (const t of due ?? []) {
        await db.from("tickets").update({ auto_transferred: true }).eq("id", t.id);
        await db
          .from("conversations")
          .update({ department_id: cfg.auto_transfer_department_id })
          .eq("id", t.conversation_id)
          .is("assigned_agent_id", null);
        transferred++;
      }
    }

    if (cfg.inactivity_enabled && cfg.inactivity_hours > 0) {
      const { data: idle } = await db
        .from("conversations")
        .select("id, contact_id, current_ticket_id")
        .eq("account_id", acc.id)
        .neq("status", "closed")
        .lt("last_message_at", new Date(Date.now() - cfg.inactivity_hours * 3600_000).toISOString())
        .limit(50);
      const userId = await ownerOf(db, acc.id);
      for (const c of idle ?? []) {
        if (!userId || !c.current_ticket_id) continue;
        // só encerra se estamos esperando o cliente (a última mensagem foi nossa)
        const { data: last } = await db
          .from("messages")
          .select("sender_type")
          .eq("conversation_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!last || last.sender_type === "customer") continue;
        const { data: flagged } = await db
          .from("tickets")
          .update({ inactivity_closed: true })
          .eq("id", c.current_ticket_id)
          .eq("inactivity_closed", false)
          .select("id");
        if (!flagged || flagged.length === 0) continue;
        if (cfg.inactivity_text && (await canSendFreeText(db, acc.id, c.id))) {
          await engineSendText({ accountId: acc.id, userId, conversationId: c.id, contactId: c.contact_id, text: cfg.inactivity_text }).catch(
            () => undefined,
          );
        }
        await db
          .from("conversations")
          .update({ status: "closed", closed_reason_id: cfg.inactivity_reason_id || null })
          .eq("id", c.id);
        closed++;
      }
    }
  }
  return { sent, transferred, closed };
}
