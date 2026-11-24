"use client";

// Atendimentos (tickets) de uma conversa: um por ciclo, com a linha do
// tempo de cada um (migration 069). Somente leitura; tudo é gravado por
// trigger no banco.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Ticket as TicketIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAttendance } from "@/hooks/use-attendance";
import { cn } from "@/lib/utils";

export interface TicketRow {
  id: string;
  number: number;
  department_id: string | null;
  assigned_agent_id: string | null;
  opened_at: string;
  accepted_at: string | null;
  closed_at: string | null;
  closed_reason_id: string | null;
  rating: number | null;
}
interface EventRow {
  id: string;
  ticket_id: string;
  type: string;
  actor_user_id: string | null;
  agent_id: string | null;
  department_id: string | null;
  closed_reason_id: string | null;
  created_at: string;
}

export function TicketHistory({
  conversationId,
  onTickets,
}: {
  conversationId: string | null | undefined;
  /** Hands the loaded tickets to the parent (notes show their ticket number). */
  onTickets?: (tickets: TicketRow[]) => void;
}) {
  const t = useTranslations("Inbox.tickets");
  const { departments, reasons } = useAttendance();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      const db = createClient();
      const { data: tk } = await db
        .from("tickets")
        .select("id, number, department_id, assigned_agent_id, opened_at, accepted_at, closed_at, closed_reason_id, rating")
        .eq("conversation_id", conversationId)
        .order("opened_at", { ascending: false })
        .limit(20);
      const list = (tk ?? []) as TicketRow[];
      const [{ data: ev }, { data: pr }] = await Promise.all([
        list.length
          ? db.from("ticket_events").select("*").in("ticket_id", list.map((x) => x.id)).order("created_at")
          : Promise.resolve({ data: [] }),
        db.from("profiles").select("user_id, full_name, email"),
      ]);
      if (cancelled) return;
      setTickets(list);
      setOpen(list[0]?.id ?? null);
      setEvents((ev ?? []) as EventRow[]);
      setNames(
        Object.fromEntries(
          ((pr ?? []) as { user_id: string; full_name: string | null; email: string }[]).map((p) => [
            p.user_id,
            p.full_name || p.email,
          ]),
        ),
      );
      onTickets?.(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, onTickets]);

  if (!conversationId || tickets.length === 0) return null;

  const dept = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "";
  const reason = (id: string | null) => reasons.find((r) => r.id === id)?.name ?? "";
  const who = (id: string | null) => (id ? (names[id] ?? t("someone")) : t("system"));
  const fmt = (d: string) => format(new Date(d), "dd/MM/yy HH:mm");

  const describe = (e: EventRow) => {
    switch (e.type) {
      case "opened":
        return t("evOpened", { dept: dept(e.department_id) || "-" });
      case "reopened":
        return t("evReopened");
      case "assigned":
        return t("evAssigned", { agent: who(e.agent_id) });
      case "transferred":
        return t("evTransferred", { agent: who(e.agent_id), by: who(e.actor_user_id) });
      case "unassigned":
        return t("evUnassigned", { by: who(e.actor_user_id) });
      case "department":
        return t("evDepartment", { dept: dept(e.department_id), by: who(e.actor_user_id) });
      case "pending":
        return t("evPending", { by: who(e.actor_user_id) });
      case "resumed":
        return t("evResumed");
      case "closed":
        return t("evClosed", { reason: reason(e.closed_reason_id) || "-", by: who(e.actor_user_id) });
      case "rated":
        return t("evRated");
      default:
        return e.type;
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <TicketIcon className="h-3 w-3" />
        {t("title")}
      </div>
      <ul className="mt-2 space-y-1.5">
        {tickets.map((tk) => {
          const expanded = open === tk.id;
          return (
            <li key={tk.id} className="rounded-lg bg-muted px-3 py-2">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : tk.id)}
                className="flex w-full items-center gap-1.5 text-left text-xs"
              >
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span className="font-semibold text-foreground">#{tk.number}</span>
                <span className="truncate text-muted-foreground">{dept(tk.department_id)}</span>
                <span
                  className={cn(
                    "ml-auto rounded px-1.5 py-0.5 text-[10px]",
                    tk.closed_at ? "bg-muted-foreground/20 text-muted-foreground" : "bg-primary/15 text-primary",
                  )}
                >
                  {tk.closed_at ? t("closed") : tk.assigned_agent_id ? t("attending") : t("queue")}
                </span>
              </button>
              {expanded ? (
                <div className="mt-2 space-y-1 border-l border-border pl-3">
                  <p className="text-[11px] text-muted-foreground">
                    {t("summary", {
                      opened: fmt(tk.opened_at),
                      agent: tk.assigned_agent_id ? who(tk.assigned_agent_id) : "-",
                    })}
                  </p>
                  {events
                    .filter((e) => e.ticket_id === tk.id)
                    .map((e) => (
                      <p key={e.id} className="text-[11px] text-foreground">
                        <span className="text-muted-foreground">{fmt(e.created_at)}</span> {describe(e)}
                      </p>
                    ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
