"use client";

// Relatório de atendimento: tickets do período por atendente, setor e
// motivo. A RLS decide o que cada um vê (admin: tudo; atendente: os seus
// e os da fila, conforme as regras da conta).

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { subDays } from "date-fns";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAttendance } from "@/hooks/use-attendance";
import { buildReport, formatMinutes, type GroupRow, type ReportTicket } from "@/lib/attendance/report";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PERIODS = [7, 30, 90] as const;

export default function AttendanceReportPage() {
  const t = useTranslations("AttendanceReport");
  const { accountId } = useAuth();
  const { departments, reasons } = useAttendance();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [rows, setRows] = useState<ReportTicket[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const db = createClient();
    Promise.all([
      db
        .from("tickets")
        .select("department_id, assigned_agent_id, opened_at, accepted_at, closed_at, closed_reason_id, rating")
        .eq("account_id", accountId)
        .gte("opened_at", subDays(new Date(), days).toISOString())
        .limit(10000), // shortcut: limite de 10 mil tickets por período; agregar no banco se passar disso
      db.from("profiles").select("user_id, full_name, email"),
    ]).then(([tk, pr]) => {
      if (cancelled) return;
      setRows((tk.data ?? []) as ReportTicket[]);
      setNames(
        Object.fromEntries(
          ((pr.data ?? []) as { user_id: string; full_name: string | null; email: string }[]).map((p) => [
            p.user_id,
            p.full_name || p.email,
          ]),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, days]);

  const report = useMemo(() => (rows ? buildReport(rows) : null), [rows]);

  const label = {
    agent: (k: string | null) => (k ? (names[k] ?? "-") : t("noAgent")),
    dept: (k: string | null) => departments.find((d) => d.id === k)?.name ?? t("noDepartment"),
    reason: (k: string | null) => reasons.find((r) => r.id === k)?.name ?? t("noReason"),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              className={cn(
                "rounded-md px-3 py-1 text-sm",
                days === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {t("lastDays", { days: p })}
            </button>
          ))}
        </div>
      </div>

      {report ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi label={t("kTickets")} value={String(report.total.tickets)} />
            <Kpi label={t("kClosed")} value={String(report.total.closed)} />
            <Kpi label={t("kInQueue")} value={String(report.inQueue)} />
            <Kpi label={t("kWait")} value={formatMinutes(report.total.avgWaitMin)} />
            <Kpi label={t("kHandle")} value={formatMinutes(report.total.avgHandleMin)} />
            <Kpi label={t("kRating")} value={report.total.avgRating ? report.total.avgRating.toFixed(1) : "-"} />
          </div>
          <GroupTable title={t("byAgent")} rows={report.byAgent} name={label.agent} t={t} />
          <GroupTable title={t("byDepartment")} rows={report.byDepartment} name={label.dept} t={t} />
          <GroupTable title={t("byReason")} rows={report.byReason} name={label.reason} t={t} simple />
        </>
      ) : null}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function GroupTable({
  title,
  rows,
  name,
  t,
  simple,
}: {
  title: string;
  rows: GroupRow[];
  name: (k: string | null) => string;
  t: ReturnType<typeof useTranslations>;
  simple?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colName")}</TableHead>
              <TableHead className="text-right">{t("kTickets")}</TableHead>
              {!simple && (
                <>
                  <TableHead className="text-right">{t("kClosed")}</TableHead>
                  <TableHead className="text-right">{t("kWait")}</TableHead>
                  <TableHead className="text-right">{t("kHandle")}</TableHead>
                  <TableHead className="text-right">{t("kRating")}</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.key ?? "none"}>
                  <TableCell>{name(r.key)}</TableCell>
                  <TableCell className="text-right">{r.tickets}</TableCell>
                  {!simple && (
                    <>
                      <TableCell className="text-right">{r.closed}</TableCell>
                      <TableCell className="text-right">{formatMinutes(r.avgWaitMin)}</TableCell>
                      <TableCell className="text-right">{formatMinutes(r.avgHandleMin)}</TableCell>
                      <TableCell className="text-right">{r.avgRating ? r.avgRating.toFixed(1) : "-"}</TableCell>
                    </>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
