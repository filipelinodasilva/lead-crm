"use client";

// Platform admin panel: every account, its trial, manual block/unblock
// and "enter as" (switch_account works for platform admins on any account).

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { LogIn } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { statusKey } from "../subcontas/page";

interface AdminAccount {
  id: string;
  name: string;
  status: string;
  trial_ends_at: string | null;
  created_at: string;
  parent_name: string | null;
  owner_email: string | null;
  members: number;
}

export default function AdminPage() {
  const t = useTranslations("Admin");
  const ts = useTranslations("Subaccounts");
  const { isPlatformAdmin, profileLoading, accountId, switchAccount } = useAuth();
  const [rows, setRows] = useState<AdminAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/accounts");
    if (!res.ok) {
      toast.error(t("loadFailed"));
      return;
    }
    const json = (await res.json()) as { accounts: AdminAccount[] };
    setRows(json.accounts);
  }, [t]);

  useEffect(() => {
    if (!profileLoading && isPlatformAdmin) {
      load();
    }
  }, [profileLoading, isPlatformAdmin, load]);

  const act = async (id: string, action: "activate" | "block" | "extend_trial") => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("saved"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setBusy(null);
    }
  };

  if (profileLoading) return null;
  if (!isPlatformAdmin) {
    return <p className="text-sm text-muted-foreground">{t("forbidden")}</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("description", { count: rows?.length ?? 0 })}
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colAccount")}</TableHead>
              <TableHead>{t("colOwner")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead>{t("colTrial")}</TableHead>
              <TableHead>{t("colMembers")}</TableHead>
              <TableHead>{t("colCreated")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((a) => (
              <TableRow key={a.id} className={a.id === accountId ? "bg-primary/5" : undefined}>
                <TableCell>
                  <p className="font-medium text-foreground">{a.name}</p>
                  {a.parent_name ? (
                    <p className="text-xs text-muted-foreground">
                      {t("subaccountOf", { name: a.parent_name })}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{a.owner_email ?? ""}</TableCell>
                <TableCell>
                  <Badge variant="outline">{ts(statusKey(a))}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {a.trial_ends_at ? new Date(a.trial_ends_at).toLocaleDateString() : ""}
                </TableCell>
                <TableCell className="text-muted-foreground">{a.members}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(a.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-1">
                    {a.status !== "active" ? (
                      <Button size="xs" disabled={busy === a.id} onClick={() => act(a.id, "activate")}>
                        {t("activate")}
                      </Button>
                    ) : null}
                    {a.status !== "blocked" ? (
                      <Button
                        size="xs"
                        variant="destructive"
                        disabled={busy === a.id}
                        onClick={() => act(a.id, "block")}
                      >
                        {t("block")}
                      </Button>
                    ) : null}
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy === a.id}
                      onClick={() => act(a.id, "extend_trial")}
                    >
                      {t("extendTrial")}
                    </Button>
                    {a.id !== accountId ? (
                      <Button size="xs" variant="outline" onClick={() => switchAccount(a.id)}>
                        <LogIn className="size-3" />
                        {t("enter")}
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
