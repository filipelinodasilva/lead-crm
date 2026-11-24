"use client";

// Subcontas: the accounts hanging under the user's own account
// (migration 067). Owner/admin create them and step inside; the data
// of each one stays isolated by RLS exactly like any other account.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Building2, LogIn, Plus } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth, isAccountBlocked } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface SubaccountRow {
  id: string;
  name: string;
  status: string;
  trial_ends_at: string | null;
  created_at: string;
}

export function statusKey(a: { status: string; trial_ends_at: string | null }) {
  if (isAccountBlocked(a)) return a.status === "trial" ? "statusExpired" : "statusBlocked";
  return a.status === "trial" ? "statusTrial" : "statusActive";
}

export default function SubaccountsPage() {
  const t = useTranslations("Subaccounts");
  const { homeAccountId, account, inSubaccount, canManageMembers, switchAccount } =
    useAuth();
  const [rows, setRows] = useState<SubaccountRow[] | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!homeAccountId) return;
    const { data, error } = await createClient()
      .from("accounts")
      .select("id, name, status, trial_ends_at, created_at")
      .eq("parent_account_id", homeAccountId)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as SubaccountRow[]);
  }, [homeAccountId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { error } = await createClient().rpc("create_subaccount", {
        p_name: name.trim(),
      });
      if (error) throw error;
      toast.success(t("created"));
      setName("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSaving(false);
    }
  };

  // A subaccount cannot have subaccounts: nothing to manage here.
  const isChild = !!account?.parent_account_id;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {inSubaccount ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="text-sm">{t("inside", { name: account?.name ?? "" })}</span>
            <Button variant="outline" onClick={() => switchAccount(null)}>
              {t("backHome")}
            </Button>
          </CardContent>
        </Card>
      ) : isChild ? (
        <p className="text-sm text-muted-foreground">{t("childCannot")}</p>
      ) : (
        <>
          {canManageMembers ? (
            <form onSubmit={create} className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                maxLength={80}
                required
              />
              <Button type="submit" disabled={saving}>
                <Plus className="size-4" />
                {t("create")}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{t("onlyAdmins")}</p>
          )}

          {rows === null ? null : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <Building2 className="size-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.trial_ends_at
                            ? t("trialUntil", {
                                date: new Date(r.trial_ends_at).toLocaleDateString(),
                              })
                            : ""}
                        </p>
                      </div>
                      <Badge variant="outline">{t(statusKey(r))}</Badge>
                      <Button size="sm" onClick={() => switchAccount(r.id)}>
                        <LogIn className="size-4" />
                        {t("enter")}
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
