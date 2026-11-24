"use client";

// Setores, membros por setor, motivos de encerramento e regras de
// atendimento da conta ativa (migration 068). Uma leitura por montagem;
// `reload()` depois de salvar nas configurações.

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export interface Department {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
  /** Migration 070 (atendimento automático). */
  greeting_message?: string;
  out_of_hours_message?: string;
  schedule?: { days?: number[]; start?: string; end?: string };
}
export interface DepartmentMember {
  department_id: string;
  user_id: string;
  role: "agent" | "supervisor";
}
export interface CloseReason {
  id: string;
  name: string;
  sort_order: number;
}
export interface TicketRules {
  assumed_visibility: "owner" | "department" | "everyone";
  supervisors_see_assumed: boolean;
  queue_visibility: "department" | "everyone";
  viewers_see_conversations: boolean;
  agents_can_transfer: boolean;
  require_close_reason: boolean;
  reopen_with_last_agent_hours: number;
}

/** Mirrors `ticket_rule()` defaults in migration 068. */
export const DEFAULT_TICKET_RULES: TicketRules = {
  assumed_visibility: "owner",
  supervisors_see_assumed: true,
  queue_visibility: "department",
  viewers_see_conversations: false,
  agents_can_transfer: true,
  require_close_reason: true,
  reopen_with_last_agent_hours: 24,
};

// The DB stores every rule as text (`ticket_rules ->> key`), so booleans and
// numbers may come back as strings; normalise once here.
export function parseTicketRules(raw: Record<string, unknown> | null | undefined): TicketRules {
  const r = raw ?? {};
  const bool = (k: keyof TicketRules) =>
    r[k] === undefined ? (DEFAULT_TICKET_RULES[k] as boolean) : String(r[k]) === "true";
  return {
    assumed_visibility: (r.assumed_visibility as TicketRules["assumed_visibility"]) ?? "owner",
    supervisors_see_assumed: bool("supervisors_see_assumed"),
    queue_visibility: (r.queue_visibility as TicketRules["queue_visibility"]) ?? "department",
    viewers_see_conversations: bool("viewers_see_conversations"),
    agents_can_transfer: bool("agents_can_transfer"),
    require_close_reason: bool("require_close_reason"),
    reopen_with_last_agent_hours:
      r.reopen_with_last_agent_hours === undefined
        ? 24
        : Number(r.reopen_with_last_agent_hours) || 0,
  };
}

export function useAttendance() {
  const { accountId } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [reasons, setReasons] = useState<CloseReason[]>([]);
  const [rules, setRules] = useState<TicketRules>(DEFAULT_TICKET_RULES);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const db = createClient();
    const [d, m, r, a] = await Promise.all([
      db.from("departments").select("*").eq("account_id", accountId).order("created_at"),
      db.from("department_members").select("department_id, user_id, role"),
      db.from("close_reasons").select("id, name, sort_order").eq("account_id", accountId).order("sort_order"),
      db.from("accounts").select("ticket_rules").eq("id", accountId).maybeSingle(),
    ]);
    setDepartments((d.data ?? []) as Department[]);
    setMembers((m.data ?? []) as DepartmentMember[]);
    setReasons((r.data ?? []) as CloseReason[]);
    setRules(parseTicketRules(a.data?.ticket_rules as Record<string, unknown> | null));
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  return { departments, members, reasons, rules, loading, reload };
}
