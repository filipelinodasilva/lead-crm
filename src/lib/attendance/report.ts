// Métricas do relatório de atendimento, calculadas sobre os tickets
// (migration 069). Função pura para ser testável.

export interface ReportTicket {
  department_id: string | null;
  assigned_agent_id: string | null;
  opened_at: string;
  accepted_at: string | null;
  closed_at: string | null;
  closed_reason_id: string | null;
  rating: number | null;
}

export interface GroupRow {
  key: string | null;
  tickets: number;
  closed: number;
  avgWaitMin: number | null;
  avgHandleMin: number | null;
  avgRating: number | null;
}

const minutes = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function summarize(key: string | null, list: ReportTicket[]): GroupRow {
  return {
    key,
    tickets: list.length,
    closed: list.filter((t) => t.closed_at).length,
    // espera = abertura até alguém assumir; atendimento = assumir até encerrar
    avgWaitMin: avg(list.filter((t) => t.accepted_at).map((t) => minutes(t.opened_at, t.accepted_at!))),
    avgHandleMin: avg(
      list.filter((t) => t.accepted_at && t.closed_at).map((t) => minutes(t.accepted_at!, t.closed_at!)),
    ),
    avgRating: avg(list.filter((t) => t.rating != null).map((t) => t.rating!)),
  };
}

function groupBy(list: ReportTicket[], pick: (t: ReportTicket) => string | null): GroupRow[] {
  const m = new Map<string | null, ReportTicket[]>();
  for (const t of list) {
    const k = pick(t);
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return [...m.entries()].map(([k, l]) => summarize(k, l)).sort((a, b) => b.tickets - a.tickets);
}

export function buildReport(list: ReportTicket[]) {
  return {
    total: summarize(null, list),
    open: list.filter((t) => !t.closed_at).length,
    inQueue: list.filter((t) => !t.closed_at && !t.assigned_agent_id).length,
    byAgent: groupBy(list, (t) => t.assigned_agent_id),
    byDepartment: groupBy(list, (t) => t.department_id),
    byReason: groupBy(list.filter((t) => t.closed_at), (t) => t.closed_reason_id),
  };
}

export function formatMinutes(m: number | null): string {
  if (m == null) return "-";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} d`;
}
