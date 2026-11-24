"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, Lock } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

/** Amber line above every page while the account is in its free trial. */
export function TrialBanner() {
  const { account, isBlocked } = useAuth();
  const t = useTranslations("Trial");
  // Read the clock once per mount (render must stay pure).
  const [now] = useState(() => Date.now());
  if (!account || account.status !== "trial" || isBlocked || !account.trial_ends_at) return null;
  const days = Math.max(
    0,
    Math.ceil((new Date(account.trial_ends_at).getTime() - now) / 86_400_000),
  );
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
      <Clock className="size-4 shrink-0" />
      <span>
        {t("banner", { days, date: new Date(account.trial_ends_at).toLocaleDateString() })}
      </span>
    </div>
  );
}

/** Replaces the whole dashboard once the trial ended or the platform blocked the account. */
export function BlockedScreen() {
  const { account, inSubaccount, switchAccount, signOut } = useAuth();
  const t = useTranslations("Trial");
  const expired = account?.status === "trial";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-300">
          <Lock className="size-7" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">
          {expired ? t("expiredTitle") : t("blockedTitle")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {expired && account?.trial_ends_at
            ? t("expiredBody", { date: new Date(account.trial_ends_at).toLocaleDateString() })
            : t("blockedBody")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("accountName", { name: account?.name ?? "" })}
        </p>
        <p className="mt-4 text-foreground">{t("contact")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {inSubaccount ? (
            <Button onClick={() => switchAccount(null)}>{t("backHome")}</Button>
          ) : null}
          <Button variant="outline" onClick={signOut}>
            {t("signOut")}
          </Button>
        </div>
      </div>
    </div>
  );
}
