"use client";

// Configurações > Atendimento: setores e seus membros, motivos de
// encerramento e as regras de atendimento da conta (migration 068).
// Tudo salva direto pelo Supabase; a RLS exige admin+ para escrever.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Star, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_TICKET_RULES,
  useAttendance,
  type Department,
  type TicketRules,
} from "@/hooks/use-attendance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";
import { AttendanceAutomation, DepartmentHours } from "./attendance-automation";

interface Member {
  user_id: string;
  full_name: string | null;
  email: string;
}

export function AttendanceSettings() {
  const t = useTranslations("Settings.attendance");
  const { accountId, canEditSettings } = useAuth();
  const { departments, members, reasons, rules, loading, reload } = useAttendance();
  const [people, setPeople] = useState<Member[]>([]);
  const [newDept, setNewDept] = useState("");
  const [newReason, setNewReason] = useState("");
  const [draft, setDraft] = useState<TicketRules>(DEFAULT_TICKET_RULES);
  const [saving, setSaving] = useState(false);
  const disabled = !canEditSettings;

  useEffect(() => {
    setDraft(rules);
  }, [rules]);

  useEffect(() => {
    if (!accountId) return;
    createClient()
      .from("profiles")
      .select("user_id, full_name, email")
      .eq("account_id", accountId)
      .order("full_name")
      .then(({ data }) => setPeople((data ?? []) as Member[]));
  }, [accountId]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) toast.error(error.message);
    else await reload();
  };
  const db = () => createClient();

  const addDepartment = () => {
    if (!accountId || !newDept.trim()) return;
    setNewDept("");
    run(db().from("departments").insert({ account_id: accountId, name: newDept.trim(), is_default: departments.length === 0 }));
  };
  const setDefault = (d: Department) =>
    run(
      (async () => {
        const { error } = await db().from("departments").update({ is_default: false }).eq("account_id", accountId!).eq("is_default", true);
        if (error) return { error };
        return db().from("departments").update({ is_default: true }).eq("id", d.id);
      })(),
    );
  const memberRole = (deptId: string, userId: string) =>
    members.find((m) => m.department_id === deptId && m.user_id === userId)?.role ?? null;
  const cycleMember = (deptId: string, userId: string) => {
    const role = memberRole(deptId, userId);
    if (role === null) return run(db().from("department_members").insert({ department_id: deptId, user_id: userId, role: "agent" }));
    if (role === "agent") return run(db().from("department_members").update({ role: "supervisor" }).eq("department_id", deptId).eq("user_id", userId));
    return run(db().from("department_members").delete().eq("department_id", deptId).eq("user_id", userId));
  };
  const addReason = () => {
    if (!accountId || !newReason.trim()) return;
    setNewReason("");
    run(db().from("close_reasons").insert({ account_id: accountId, name: newReason.trim(), sort_order: reasons.length + 1 }));
  };
  const saveRules = async () => {
    if (!accountId) return;
    setSaving(true);
    const { error } = await db().from("accounts").update({ ticket_rules: draft }).eq("id", accountId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t("rulesSaved"));
      reload();
    }
  };

  if (loading) return null;

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {/* Setores */}
      <Card>
        <CardHeader>
          <CardTitle>{t("departments")}</CardTitle>
          <CardDescription>{t("departmentsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {departments.map((d) => (
            <div key={d.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="color"
                  value={d.color}
                  disabled={disabled}
                  onChange={(e) => run(db().from("departments").update({ color: e.target.value }).eq("id", d.id))}
                  className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent"
                  aria-label={t("color")}
                />
                <Input
                  defaultValue={d.name}
                  disabled={disabled}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && run(db().from("departments").update({ name: e.target.value.trim() }).eq("id", d.id))}
                  className="h-8 max-w-xs"
                />
                <Button size="xs" variant={d.is_default ? "default" : "outline"} disabled={disabled || d.is_default} onClick={() => setDefault(d)}>
                  <Star className="size-3" />
                  {d.is_default ? t("isDefault") : t("makeDefault")}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled || d.is_default}
                  onClick={() => run(db().from("departments").delete().eq("id", d.id))}
                  aria-label={t("remove")}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <DepartmentHours department={d} onSaved={reload} />
              <p className="mt-2 text-xs text-muted-foreground">{t("membersHint")}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {people.map((p) => {
                  const role = memberRole(d.id, p.user_id);
                  return (
                    <button
                      key={p.user_id}
                      type="button"
                      disabled={disabled}
                      onClick={() => cycleMember(d.id, p.user_id)}
                      className={
                        "rounded-full border px-2.5 py-1 text-xs " +
                        (role === "supervisor"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                          : role === "agent"
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground")
                      }
                    >
                      {p.full_name || p.email}
                      {role ? ` · ${t(role)}` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!disabled && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addDepartment();
              }}
              className="flex gap-2"
            >
              <Input value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder={t("newDepartment")} maxLength={60} required className="h-8 max-w-xs" />
              <Button size="sm" type="submit">
                <Plus className="size-3.5" />
                {t("add")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Motivos de encerramento */}
      <Card>
        <CardHeader>
          <CardTitle>{t("closeReasons")}</CardTitle>
          <CardDescription>{t("closeReasonsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
                {r.name}
                {!disabled && (
                  <button type="button" onClick={() => run(db().from("close_reasons").delete().eq("id", r.id))} aria-label={t("remove")} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
          {!disabled && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addReason();
              }}
              className="flex gap-2"
            >
              <Input value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder={t("newReason")} maxLength={60} required className="h-8 max-w-xs" />
              <Button size="sm" type="submit">
                <Plus className="size-3.5" />
                {t("add")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Regras */}
      <Card>
        <CardHeader>
          <CardTitle>{t("rules")}</CardTitle>
          <CardDescription>{t("rulesDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <RuleRow label={t("assumedVisibility")} hint={t("assumedVisibilityHint")}>
            <select
              value={draft.assumed_visibility}
              disabled={disabled}
              onChange={(e) => setDraft({ ...draft, assumed_visibility: e.target.value as TicketRules["assumed_visibility"] })}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="owner">{t("visOwner")}</option>
              <option value="department">{t("visDepartment")}</option>
              <option value="everyone">{t("visEveryone")}</option>
            </select>
          </RuleRow>
          <RuleRow label={t("supervisorsSeeAssumed")} hint={t("supervisorsSeeAssumedHint")}>
            <Switch checked={draft.supervisors_see_assumed} disabled={disabled} onCheckedChange={(v) => setDraft({ ...draft, supervisors_see_assumed: v })} />
          </RuleRow>
          <RuleRow label={t("queueVisibility")} hint={t("queueVisibilityHint")}>
            <select
              value={draft.queue_visibility}
              disabled={disabled}
              onChange={(e) => setDraft({ ...draft, queue_visibility: e.target.value as TicketRules["queue_visibility"] })}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="department">{t("visDepartment")}</option>
              <option value="everyone">{t("visEveryone")}</option>
            </select>
          </RuleRow>
          <RuleRow label={t("viewersSee")} hint={t("viewersSeeHint")}>
            <Switch checked={draft.viewers_see_conversations} disabled={disabled} onCheckedChange={(v) => setDraft({ ...draft, viewers_see_conversations: v })} />
          </RuleRow>
          <RuleRow label={t("agentsCanTransfer")} hint={t("agentsCanTransferHint")}>
            <Switch checked={draft.agents_can_transfer} disabled={disabled} onCheckedChange={(v) => setDraft({ ...draft, agents_can_transfer: v })} />
          </RuleRow>
          <RuleRow label={t("requireCloseReason")} hint={t("requireCloseReasonHint")}>
            <Switch checked={draft.require_close_reason} disabled={disabled} onCheckedChange={(v) => setDraft({ ...draft, require_close_reason: v })} />
          </RuleRow>
          <RuleRow label={t("reopenHours")} hint={t("reopenHoursHint")}>
            <Input
              type="number"
              min={0}
              max={720}
              value={draft.reopen_with_last_agent_hours}
              disabled={disabled}
              onChange={(e) => setDraft({ ...draft, reopen_with_last_agent_hours: Math.max(0, Number(e.target.value) || 0) })}
              className="h-8 w-24"
            />
          </RuleRow>
          {!disabled && (
            <div className="flex justify-end">
              <Button onClick={saveRules} disabled={saving}>
                {t("saveRules")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Atendimento automático (opcional, desligado por padrão) */}
      <AttendanceAutomation departments={departments} reasons={reasons} onSaved={reload} />
    </section>
  );
}

function RuleRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
