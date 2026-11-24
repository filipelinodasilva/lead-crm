"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Compass, GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Contact } from "@/types";

interface StageRow {
  id: string;
  name: string;
  position: number;
  color: string;
}

interface PipelineRow {
  id: string;
  name: string;
  stages: StageRow[];
}

interface ActiveDeal {
  id: string;
  pipeline_id: string;
  stage_id: string;
}

export function ConversationDealBar({
  contact,
  accountId,
  userId,
}: {
  contact: Contact;
  accountId: string | null;
  userId: string | undefined;
}) {
  const t = useTranslations("Inbox.messageThread");
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [deal, setDeal] = useState<ActiveDeal | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const contactId = contact.id;

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    Promise.all([
      supabase
        .from("pipelines")
        .select("id, name, pipeline_stages(id, name, position, color)")
        .order("created_at", { ascending: true }),
      supabase
        .from("deals")
        .select("id, pipeline_id, stage_id")
        .eq("contact_id", contactId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("prospect_leads")
        .select("category, city")
        .eq("contact_id", contactId)
        .limit(1),
      supabase
        .from("prospect_campaign_recipients")
        .select("id")
        .eq("contact_id", contactId)
        .limit(1),
    ])
      .then(([pipRes, dealRes, leadRes, campRes]) => {
        if (cancelled) return;

        const mappedPipelines: PipelineRow[] = (pipRes.data ?? []).map((p) => ({
          id: p.id as string,
          name: p.name as string,
          stages: [...((p.pipeline_stages ?? []) as StageRow[])].sort(
            (a, b) => a.position - b.position,
          ),
        }));
        setPipelines(mappedPipelines);

        const openDeal = (dealRes.data?.[0] as ActiveDeal | undefined) ?? null;
        setDeal(openDeal);

        const hasCampaign = (campRes.data?.length ?? 0) > 0;
        const leadRow = leadRes.data?.[0] as
          | { category?: string | null; city?: string | null }
          | undefined;

        if (hasCampaign) {
          setOrigin(t("originCampaign"));
        } else if (leadRow) {
          const detail = (leadRow.category ?? leadRow.city ?? "").replace(
            /_/g,
            " ",
          );
          setOrigin(
            detail ? `${t("originMaps")} · ${detail}` : t("originMaps"),
          );
        } else {
          setOrigin(null);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [contactId, t]);

  const handleSelectStage = useCallback(
    async (pipelineId: string, stageId: string) => {
      if (!accountId || saving) return;
      setSaving(true);
      const supabase = createClient();

      try {
        if (deal && deal.pipeline_id === pipelineId) {
          const { error } = await supabase
            .from("deals")
            .update({ stage_id: stageId })
            .eq("id", deal.id)
            .eq("account_id", accountId);
          if (error) throw error;
          setDeal({ ...deal, stage_id: stageId });
        } else if (deal) {
          const { error } = await supabase
            .from("deals")
            .update({ pipeline_id: pipelineId, stage_id: stageId })
            .eq("id", deal.id)
            .eq("account_id", accountId);
          if (error) throw error;
          setDeal({ ...deal, pipeline_id: pipelineId, stage_id: stageId });
        } else {
          const { data, error } = await supabase
            .from("deals")
            .insert({
              account_id: accountId,
              user_id: userId,
              pipeline_id: pipelineId,
              stage_id: stageId,
              contact_id: contactId,
              title: contact.name || contact.phone || "Lead",
              value: 0,
              status: "open",
            })
            .select("id, pipeline_id, stage_id")
            .single();
          if (error || !data) throw error ?? new Error("insert failed");
          setDeal(data as ActiveDeal);
        }
        toast.success(t("stageUpdated"));
      } catch {
        toast.error(t("stageUpdateFailed"));
      } finally {
        setSaving(false);
      }
    },
    [accountId, contact.name, contact.phone, contactId, deal, saving, t, userId],
  );

  const activePipeline = deal
    ? pipelines.find((p) => p.id === deal.pipeline_id)
    : null;
  const activeStage = activePipeline?.stages.find(
    (s) => s.id === deal?.stage_id,
  );

  return (
    <div className="hidden items-center gap-1.5 md:flex">
      {origin && (
        <Badge
          variant="outline"
          className="max-w-[10rem] gap-1 truncate border-border text-[11px] font-normal text-muted-foreground"
          title={origin}
        >
          <Compass className="h-3 w-3 shrink-0" />
          <span className="truncate">{origin}</span>
        </Badge>
      )}

      {pipelines.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={saving}
            className={cn(
              "inline-flex h-7 max-w-[13rem] items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:bg-muted",
              activeStage
                ? "border-primary/30 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            {activeStage ? (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: activeStage.color || "#22c55e" }}
              />
            ) : (
              <GitBranch className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">
              {activeStage
                ? pipelines.length > 1 && activePipeline
                  ? `${activePipeline.name} › ${activeStage.name}`
                  : activeStage.name
                : t("addToFunnel")}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-80 w-56 overflow-y-auto border-border bg-popover"
          >
            {pipelines.map((p, idx) => (
              <div key={p.id}>
                {idx > 0 && <DropdownMenuSeparator className="bg-border" />}
                {pipelines.length > 1 && (
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {p.name}
                  </div>
                )}
                {p.stages.map((s) => {
                  const selected =
                    deal?.pipeline_id === p.id && deal?.stage_id === s.id;
                  return (
                    <DropdownMenuItem
                      key={s.id}
                      onClick={() => handleSelectStage(p.id, s.id)}
                      className={cn(
                        "text-sm",
                        selected ? "text-primary" : "text-popover-foreground",
                      )}
                    >
                      <span
                        className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: s.color || "#94a3b8" }}
                      />
                      <span className="flex-1 truncate">{s.name}</span>
                      {selected && <Check className="ml-2 h-3 w-3 shrink-0" />}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
