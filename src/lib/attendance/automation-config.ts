// Configuração e funções puras do atendimento automático (usadas pela tela e pelo servidor).

export interface AutomationConfig {
  timezone: string;
  menu_enabled: boolean;
  menu_greeting: string;
  menu_invalid_attempts: number;
  out_of_hours_enabled: boolean;
  accept_enabled: boolean;
  accept_text: string;
  transfer_enabled: boolean;
  transfer_text: string;
  close_enabled: boolean;
  close_text: string;
  rating_enabled: boolean;
  rating_text: string;
  rating_thanks: string;
  auto_transfer_enabled: boolean;
  auto_transfer_minutes: number;
  auto_transfer_department_id: string;
  inactivity_enabled: boolean;
  inactivity_hours: number;
  inactivity_text: string;
  inactivity_reason_id: string;
}

export const DEFAULT_AUTOMATION: AutomationConfig = {
  timezone: "America/Sao_Paulo",
  menu_enabled: false,
  menu_greeting: "Olá, {nome}! Para te atender melhor, escolha o setor respondendo com o número:",
  menu_invalid_attempts: 2,
  out_of_hours_enabled: false,
  accept_enabled: false,
  accept_text: "Olá, {nome}! Sou {atendente} e vou continuar o seu atendimento.",
  transfer_enabled: false,
  transfer_text: "Você foi transferido para o setor {setor}. Aguarde, já vamos te atender.",
  close_enabled: false,
  close_text: "Atendimento #{ticket} encerrado. Obrigado pelo contato!",
  rating_enabled: false,
  rating_text: "Como foi o nosso atendimento? Responda com uma nota de 1 a 5.",
  rating_thanks: "Obrigado pela avaliação!",
  auto_transfer_enabled: false,
  auto_transfer_minutes: 10,
  auto_transfer_department_id: "",
  inactivity_enabled: false,
  inactivity_hours: 24,
  inactivity_text: "Como não tivemos retorno, vamos encerrar este atendimento. É só chamar quando precisar!",
  inactivity_reason_id: "",
};

/** JSON from the DB (values may come back as strings) → typed config. */
export function parseAutomation(raw: Record<string, unknown> | null | undefined): AutomationConfig {
  const out = { ...DEFAULT_AUTOMATION } as Record<string, unknown>;
  for (const [k, def] of Object.entries(DEFAULT_AUTOMATION)) {
    const v = raw?.[k];
    if (v === undefined || v === null) continue;
    out[k] = typeof def === "boolean" ? String(v) === "true" : typeof def === "number" ? Number(v) || 0 : String(v);
  }
  return out as unknown as AutomationConfig;
}

export interface Schedule {
  days?: number[];
  start?: string;
  end?: string;
}

/** Empty schedule = always open. Evaluated in the account's timezone (the container runs in UTC). */
export function isOpenNow(schedule: Schedule | null | undefined, timezone: string, now = new Date()): boolean {
  if (!schedule || !schedule.days || schedule.days.length === 0 || !schedule.start || !schedule.end) return true;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "America/Sao_Paulo",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const hm = `${parts.hour}:${parts.minute}`;
  return schedule.days.includes(day) && hm >= schedule.start && hm < schedule.end;
}

/** "2", " 2 ", "2." → index 1; anything else → null. */
export function parseMenuChoice(text: string, count: number): number | null {
  const m = text.trim().match(/^(\d{1,2})\W?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= count ? n - 1 : null;
}

export function buildMenu(greeting: string, names: string[]): string {
  return `${greeting}\n\n${names.map((n, i) => `*${i + 1}* - ${n}`).join("\n")}`;
}

export function parseRating(text: string): number | null {
  const m = text.trim().match(/^([1-5])\W?$/);
  return m ? Number(m[1]) : null;
}

export function renderText(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{(nome|atendente|setor|ticket)\}/g, (_, k: string) => String(vars[k] ?? ""));
}
