"use client";

import type { Deal, PipelineStage } from "@/types";
import Link from "next/link";
import { Calendar, Check, MessageSquare, X } from "lucide-react";
import { WhatsAppActions } from "@/components/whatsapp/whatsapp-actions";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;

  return (
    // Um div, não um button: a linha do contato tem botões próprios (conversa e WhatsApp Web),
    // e botão dentro de botão é HTML inválido. Teclado e arrastar ficam por conta do
    // contêiner arrastável do quadro.
    <div
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
        {!isOverlay && (
          <WhatsAppActions
            phone={deal.contact?.phone}
            name={deal.contact?.name}
            className="ml-auto shrink-0"
          />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {/* Atendimento no WhatsApp: ticket, setor e situação; abre a conversa. */}
      {deal.attendance && !isOverlay ? (
        <Link
          href={`/inbox?c=${deal.attendance.conversation_id}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-2 flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <MessageSquare className="h-3 w-3 shrink-0" />
          {deal.attendance.ticket_number ? <span className="font-semibold">#{deal.attendance.ticket_number}</span> : null}
          {deal.attendance.department_name ? (
            <span className="truncate" style={{ color: deal.attendance.department_color ?? undefined }}>
              {deal.attendance.department_name}
            </span>
          ) : null}
          <span className="ml-auto shrink-0">
            {deal.attendance.status === "closed"
              ? t("attClosed")
              : deal.attendance.agent_name
                ? deal.attendance.agent_name
                : t("attQueue")}
          </span>
        </Link>
      ) : null}

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </div>
  );
}
