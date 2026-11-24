"use client";

// Configurações > Atendimento > "Atendimento automático (opcional)".
// Módulo alternativo, desligado por padrão (migration 070). Não mexe em
// fluxos, automações nem no agente de IA.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { CloseReason, Department } from "@/hooks/use-attendance";
import { DEFAULT_AUTOMATION, parseAutomation, type AutomationConfig } from "@/lib/attendance/automation-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

export function AttendanceAutomation({
  departments,
  reasons,
  onSaved,
}: {
  departments: Department[];
  reasons: CloseReason[];
  onSaved: () => void;
}) {
  const t = useTranslations("Settings.attendanceAuto");
  const { accountId, canEditSettings } = useAuth();
  const disabled = !canEditSettings;
  const [cfg, setCfg] = useState<AutomationConfig>(DEFAULT_AUTOMATION);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    createClient()
      .from("accounts")
      .select("attendance_automation")
      .eq("id", accountId)
      .maybeSingle()
      .then(({ data }) => setCfg(parseAutomation(data?.attendance_automation as Record<string, unknown> | null)));
  }, [accountId]);

  const set = <K extends keyof AutomationConfig>(k: K, v: AutomationConfig[K]) => setCfg((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!accountId) return;
    setSaving(true);
    const { error } = await createClient().from("accounts").update({ attendance_automation: cfg }).eq("id", accountId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t("saved"));
      onSaved();
    }
  };

  const toggle = (k: keyof AutomationConfig, label: string, hint: string, extra?: React.ReactNode) => (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Switch checked={cfg[k] as boolean} disabled={disabled} onCheckedChange={(v) => set(k, v as never)} />
      </div>
      {cfg[k] && extra ? <div className="mt-3 space-y-2">{extra}</div> : null}
    </div>
  );
  const text = (k: keyof AutomationConfig) => (
    <textarea
      value={cfg[k] as string}
      disabled={disabled}
      onChange={(e) => set(k, e.target.value as never)}
      rows={2}
      className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t("timezone")}</p>
            <p className="text-xs text-muted-foreground">{t("timezoneHint")}</p>
          </div>
          <Input value={cfg.timezone} disabled={disabled} onChange={(e) => set("timezone", e.target.value)} className="h-8 w-56" />
        </div>

        {toggle("menu_enabled", t("menu"), t("menuHint"), (
          <>
            {text("menu_greeting")}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("menuAttempts")}
              <Input
                type="number"
                min={0}
                max={5}
                value={cfg.menu_invalid_attempts}
                disabled={disabled}
                onChange={(e) => set("menu_invalid_attempts", Number(e.target.value) || 0)}
                className="h-7 w-16"
              />
            </label>
          </>
        ))}
        {toggle("out_of_hours_enabled", t("outOfHours"), t("outOfHoursHint"))}
        {toggle("accept_enabled", t("accept"), t("acceptHint"), text("accept_text"))}
        {toggle("transfer_enabled", t("transfer"), t("transferHint"), text("transfer_text"))}
        {toggle("close_enabled", t("close"), t("closeHint"), text("close_text"))}
        {toggle("rating_enabled", t("rating"), t("ratingHint"), (
          <>
            {text("rating_text")}
            <p className="text-xs text-muted-foreground">{t("ratingThanks")}</p>
            {text("rating_thanks")}
          </>
        ))}
        {toggle("auto_transfer_enabled", t("autoTransfer"), t("autoTransferHint"), (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {t("autoTransferAfter")}
            <Input
              type="number"
              min={1}
              value={cfg.auto_transfer_minutes}
              disabled={disabled}
              onChange={(e) => set("auto_transfer_minutes", Number(e.target.value) || 1)}
              className="h-7 w-20"
            />
            {t("autoTransferTo")}
            <select
              value={cfg.auto_transfer_department_id}
              disabled={disabled}
              onChange={(e) => set("auto_transfer_department_id", e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">-</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        ))}
        {toggle("inactivity_enabled", t("inactivity"), t("inactivityHint"), (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {t("inactivityAfter")}
              <Input
                type="number"
                min={1}
                value={cfg.inactivity_hours}
                disabled={disabled}
                onChange={(e) => set("inactivity_hours", Number(e.target.value) || 1)}
                className="h-7 w-20"
              />
              {t("inactivityReason")}
              <select
                value={cfg.inactivity_reason_id}
                disabled={disabled}
                onChange={(e) => set("inactivity_reason_id", e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">-</option>
                {reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            {text("inactivity_text")}
          </>
        ))}
        <p className="text-xs text-muted-foreground">{t("variables")}</p>
        {!disabled && (
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {t("save")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Horário, saudação e mensagem de fora de horário de um setor. */
export function DepartmentHours({ department, onSaved }: { department: Department; onSaved: () => void }) {
  const t = useTranslations("Settings.attendanceAuto");
  const { canEditSettings } = useAuth();
  const [greeting, setGreeting] = useState(department.greeting_message ?? "");
  const [ooh, setOoh] = useState(department.out_of_hours_message ?? "");
  const [days, setDays] = useState<number[]>(department.schedule?.days ?? []);
  const [start, setStart] = useState(department.schedule?.start ?? "08:00");
  const [end, setEnd] = useState(department.schedule?.end ?? "18:00");
  const save = async () => {
    const { error } = await createClient()
      .from("departments")
      .update({
        greeting_message: greeting,
        out_of_hours_message: ooh,
        schedule: days.length ? { days, start, end } : {},
      })
      .eq("id", department.id);
    if (error) toast.error(error.message);
    else {
      toast.success(t("saved"));
      onSaved();
    }
  };
  return (
    <details className="mt-2 rounded-md border border-dashed border-border px-3 py-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">{t("deptHours")}</summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground">{t("deptGreeting")}</p>
        <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2} className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" />
        <p className="text-xs text-muted-foreground">{t("deptSchedule")}</p>
        <div className="flex flex-wrap items-center gap-1">
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()))}
              className={`rounded-md border px-2 py-0.5 text-xs ${days.includes(d) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
            >
              {t(`day${d}`)}
            </button>
          ))}
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="ml-2 h-7 w-28" />
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="h-7 w-28" />
        </div>
        <p className="text-xs text-muted-foreground">{t("deptOutOfHours")}</p>
        <textarea value={ooh} onChange={(e) => setOoh(e.target.value)} rows={2} className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" />
        {canEditSettings && (
          <div className="flex justify-end">
            <Button size="sm" onClick={save}>
              {t("save")}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
