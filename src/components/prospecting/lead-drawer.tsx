'use client';

import {
  Building2,
  Check,
  ExternalLink,
  GitBranch,
  Globe,
  Loader2,
  MapPin,
  Send,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useOpenChat,
  WhatsAppActions,
} from '@/components/whatsapp/whatsapp-actions';
import { useCan } from '@/hooks/use-can';
import { waWebUrl } from '@/lib/whatsapp/links';
import { apiJson } from '@/lib/prospect/client';
import { formatCnpj, porteLabel } from '@/lib/prospect/cnpj';
import { hasAnyAdPixel } from '@/lib/prospect/site-audit';
import { createClient } from '@/lib/supabase/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { renderMessage, variablesFor } from '@/lib/prospect/campaign/message';
import { PLAYBOOK_PRESETS } from '@/lib/prospect/campaign/playbook';
import { scoreLead, type ScoreTier } from '@/lib/prospect/score';
import type { LeadRow } from '@/lib/prospect/types';
import { cn } from '@/lib/utils';

export const TIER_STYLE: Record<ScoreTier, string> = {
  hot: 'border-primary/40 bg-primary/15 text-primary',
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  warm: 'border-border bg-muted text-muted-foreground',
};

interface PipelineOption {
  id: string;
  name: string;
  stages: { id: string; name: string; position: number }[];
}

interface OpenDeal {
  pipeline_id: string;
  stage_id: string;
}

interface PlaceResult {
  added: number;
  moved: number;
  skippedNoPhone: number;
  failed: number;
}

export function LeadDrawer({
  lead,
  cnpjConfigured = false,
  onClose,
  onChanged,
}: {
  lead: LeadRow | null;
  cnpjConfigured?: boolean;
  onClose: () => void;
  /** Called after the lead was added to or moved in the funnel. */
  onChanged: () => void;
}) {
  const t = useTranslations('ProspectLead');
  const canAct = useCan('send-messages');
  const router = useRouter();
  const { openChat, dialog } = useOpenChat();
  const open = lead !== null;
  const leadId = lead?.id ?? null;
  // The contact the lead became after a message sent from this panel (the lead
  // copy held by the page is refreshed later).
  const [linked, setLinked] = useState<{
    leadId: string;
    contactId: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const contactId =
    (linked && linked.leadId === leadId ? linked.contactId : null) ??
    lead?.contact_id ??
    null;

  const [pipelines, setPipelines] = useState<PipelineOption[] | null>(null);
  const [deals, setDeals] = useState<OpenDeal[]>([]);
  // What the user picked, tied to the lead it was picked for.
  const [pick, setPick] = useState<{
    leadId: string;
    pipelineId?: string;
    stageId?: string;
  } | null>(null);
  // Where the lead was put from this panel (the list behind it refreshes later).
  const [placed, setPlaced] = useState<{
    leadId: string;
    pipelineId: string;
    stageId: string;
  } | null>(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const db = createClient();
    db.from('pipelines')
      .select('id, name, pipeline_stages(id, name, position)')
      .order('created_at')
      .then(({ data }) => {
        if (cancelled) return;
        setPipelines(
          (data ?? []).map((p) => ({
            id: p.id as string,
            name: p.name as string,
            stages: [
              ...((p.pipeline_stages ?? []) as PipelineOption['stages']),
            ].sort((a, b) => a.position - b.position),
          }))
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Where the lead already is, if it has a contact with an open deal.
  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    createClient()
      .from('deals')
      .select('pipeline_id, stage_id')
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .then(({ data }) => {
        if (!cancelled) setDeals((data ?? []) as OpenDeal[]);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId, leadId]);
  const [presetId, setPresetId] = useState(PLAYBOOK_PRESETS[0].id);
  // What the user typed, tied to the lead it was typed for. A new lead or a
  // new template drops it and the message is generated again.
  const [edit, setEdit] = useState<{ leadId: string; value: string } | null>(
    null
  );

  const result = useMemo(() => (lead ? scoreLead(lead) : null), [lead]);

  const generated = useMemo(() => {
    if (!lead) return '';
    const preset =
      PLAYBOOK_PRESETS.find((p) => p.id === presetId) ?? PLAYBOOK_PRESETS[0];
    return renderMessage(preset.text, variablesFor(lead, null), () => 0, false);
  }, [lead, presetId]);

  const text = edit && edit.leadId === lead?.id ? edit.value : generated;
  const setText = (value: string) =>
    lead && setEdit({ leadId: lead.id, value });

  // Funnel: where the lead is now (placed here, else its open deal), and the
  // pipeline and stage on the selectors (the pick, else where it is, else the first).
  const mine = pick && pick.leadId === lead?.id ? pick : null;
  const here =
    placed && placed.leadId === lead?.id
      ? placed
      : deals[0]
        ? { pipelineId: deals[0].pipeline_id, stageId: deals[0].stage_id }
        : null;
  const pipelineId =
    mine?.pipelineId ?? here?.pipelineId ?? pipelines?.[0]?.id ?? '';
  const pipeline = pipelines?.find((p) => p.id === pipelineId);
  const stageId =
    mine?.stageId ??
    (here && here.pipelineId === pipelineId ? here.stageId : undefined) ??
    pipeline?.stages[0]?.id ??
    '';
  const hereLabel = (() => {
    if (!here) return null;
    const p = pipelines?.find((x) => x.id === here.pipelineId);
    const s = p?.stages.find((x) => x.id === here.stageId);
    return p && s ? `${p.name} › ${s.name}` : null;
  })();
  const alreadyThere =
    here !== null && here.pipelineId === pipelineId && lead?.status !== 'discarded';

  async function placeInFunnel() {
    if (!lead || !stageId) return;
    setPlacing(true);
    try {
      const r = await apiJson<PlaceResult>('/api/prospect/leads/pipeline', {
        method: 'POST',
        body: JSON.stringify({
          ids: [lead.id],
          pipelineId,
          stageId,
          moveExisting: true,
        }),
      });
      const stageName = pipeline?.stages.find((s) => s.id === stageId)?.name;
      if (r.skippedNoPhone > 0) toast.error(t('funnelNoPhone'));
      else if (r.failed > 0) toast.error(t('funnelFailed'));
      else {
        // The lead is now a contact too: offer the shortcut to talk to it.
        const chatPhone = lead.phone_e164 ?? lead.phone;
        toast.success(
          r.moved > 0
            ? t('funnelMoved', { stage: stageName ?? '' })
            : t('funnelAdded', { stage: stageName ?? '' }),
          chatPhone
            ? {
                action: {
                  label: t('openChat'),
                  onClick: () => openChat(chatPhone, lead.name),
                },
              }
            : undefined
        );
        setPlaced({ leadId: lead.id, pipelineId, stageId });
        onChanged();
      }
    } catch (err) {
      toast.error(
        err instanceof Error && err.message !== 'error'
          ? err.message
          : t('funnelFailed')
      );
    } finally {
      setPlacing(false);
    }
  }

  const phone = lead?.phone_e164 ?? lead?.phone ?? null;
  // Opens the chat on WhatsApp Web with the message ready (the old "Enviar no WhatsApp" link).
  const webUrl = waWebUrl(phone, text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  // Sends from the platform itself, through the connected number: the contact and the
  // conversation are created (if missing), the lead is linked to the contact, and the
  // reply lands in the inbox. Refused for numbers that asked to stop (SAIR).
  async function sendBySystem() {
    if (!lead || !text.trim()) return;
    setSending(true);
    try {
      const r = await apiJson<{ conversation_id: string; contact_id: string }>(
        '/api/prospect/leads/message',
        {
          method: 'POST',
          body: JSON.stringify({ leadId: lead.id, text }),
        }
      );
      setLinked({ leadId: lead.id, contactId: r.contact_id });
      toast.success(t('sentSystem'), {
        action: {
          label: t('openChat'),
          onClick: () => router.push(`/inbox?c=${r.conversation_id}`),
        },
      });
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message !== 'error'
          ? err.message
          : t('sendFailed')
      );
    } finally {
      setSending(false);
    }
  }

  const [cnpjBusy, setCnpjBusy] = useState(false);
  const [siteBusy, setSiteBusy] = useState(false);

  async function auditSiteNow() {
    if (!lead?.website) return;
    setSiteBusy(true);
    try {
      await apiJson('/api/prospect/leads/site-audit', {
        method: 'POST',
        body: JSON.stringify({ ids: [lead.id], force: true }),
      });
      toast.success(t('siteAuditSaved'));
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message !== 'error'
          ? err.message
          : t('sendFailed')
      );
    } finally {
      setSiteBusy(false);
    }
  }
  const [manualInput, setManualInput] = useState<{
    leadId: string;
    value: string;
  } | null>(null);
  const manualCnpj =
    manualInput && manualInput.leadId === lead?.id ? manualInput.value : '';

  async function lookupCnpjNow() {
    if (!lead) return;
    setCnpjBusy(true);
    try {
      await apiJson('/api/prospect/leads/enrich', {
        method: 'POST',
        body: JSON.stringify({ ids: [lead.id], force: true }),
      });
      toast.success(t('cnpjSaved'));
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message !== 'error'
          ? err.message
          : t('sendFailed')
      );
    } finally {
      setCnpjBusy(false);
    }
  }

  async function applyCnpj(cnpj: string | null) {
    if (!lead) return;
    setCnpjBusy(true);
    try {
      await apiJson(`/api/prospect/leads/${lead.id}/cnpj`, {
        method: 'PATCH',
        body: JSON.stringify({ cnpj }),
      });
      setManualInput(null);
      toast.success(t('cnpjSaved'));
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message !== 'error'
          ? err.message
          : t('sendFailed')
      );
    } finally {
      setCnpjBusy(false);
    }
  }

  return (
    <>
    <Sheet open={lead !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl"
      >
        {lead && result && (
          <div className="flex flex-col gap-5 p-5">
            <SheetHeader className="p-0">
              <SheetTitle className="text-lg">{lead.name}</SheetTitle>
              <SheetDescription>
                {[lead.category?.replace(/_/g, ' '), lead.city]
                  .filter(Boolean)
                  .join(' · ')}
              </SheetDescription>
            </SheetHeader>

            <div className="flex items-start gap-4">
              <div className="text-center">
                <div className="text-primary text-4xl leading-none font-semibold tabular-nums">
                  {result.score}
                </div>
                <span
                  className={cn(
                    'mt-2 inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium',
                    TIER_STYLE[result.tier]
                  )}
                >
                  {t(`tier_${result.tier}`)}
                </span>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                <p>{result.reason}</p>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {lead.rating !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Star
                        className="h-3.5 w-3.5 fill-current text-amber-500"
                        aria-hidden
                      />
                      {lead.rating.toFixed(1)} · {lead.review_count}
                    </span>
                  )}
                  {lead.phone && (
                    <span className="inline-flex items-center gap-1">
                      {lead.phone}
                      <WhatsAppActions
                        phone={lead.phone_e164 ?? lead.phone}
                        name={lead.name}
                      />
                    </span>
                  )}
                  {lead.maps_url && (
                    <a
                      href={lead.maps_url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      <MapPin className="h-3 w-3" aria-hidden />
                      {t('openMaps')}
                    </a>
                  )}
                  {lead.website && (
                    <a
                      href={lead.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      {t('openSite')}
                    </a>
                  )}
                </div>
              </div>
            </div>

            {(cnpjConfigured || lead.cnpj_checked_at || lead.cnpj) && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
                    <Building2 className="h-3.5 w-3.5" aria-hidden />
                    {t('cnpjTitle')}
                  </span>
                  {lead.cnpj_match_status === 'matched' && lead.cnpj && (
                    <span className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium">
                      {formatCnpj(lead.cnpj)}
                    </span>
                  )}
                  {lead.cnpj_match_status === 'review' && (
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                      {t('cnpjReviewBadge')}
                    </span>
                  )}
                </div>

                {lead.cnpj_match_status === 'matched' && lead.cnpj_data ? (
                  <div className="space-y-2 text-xs">
                    {lead.cnpj_data.razao_social && (
                      <div>
                        <span className="text-muted-foreground">
                          {t('cnpjRazao')}:{' '}
                        </span>
                        <span className="font-medium">
                          {lead.cnpj_data.razao_social}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {porteLabel(lead.cnpj_data) && (
                        <span className="bg-muted rounded px-1.5 py-0.5 font-medium">
                          {porteLabel(lead.cnpj_data)}
                        </span>
                      )}
                      {lead.cnpj_data.simples && !lead.cnpj_data.mei && (
                        <span className="bg-muted rounded px-1.5 py-0.5">
                          Simples Nacional
                        </span>
                      )}
                      {lead.cnpj_data.data_inicio && (
                        <span className="bg-muted rounded px-1.5 py-0.5">
                          {t('cnpjOpened')}: {lead.cnpj_data.data_inicio}
                        </span>
                      )}
                    </div>
                    {lead.cnpj_data.cnae_descricao && (
                      <p className="text-muted-foreground">
                        {lead.cnpj_data.cnae_descricao}
                      </p>
                    )}
                    {(lead.cnpj_data.email || lead.cnpj_data.telefone1) && (
                      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                        {lead.cnpj_data.email && (
                          <span>{lead.cnpj_data.email}</span>
                        )}
                        {lead.cnpj_data.telefone1 && (
                          <span>
                            {lead.cnpj_data.telefone1.replace(
                              /^(\d{2})(\d{4,5})(\d{4})$/,
                              '($1) $2-$3'
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    {lead.cnpj_data.socios?.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <span className="text-muted-foreground font-medium">
                          {t('cnpjPartners')}:
                        </span>
                        <ul className="space-y-0.5">
                          {lead.cnpj_data.socios.map((s, idx) => (
                            <li key={`${s.nome}-${idx}`}>
                              <span className="font-medium">{s.nome}</span>
                              {s.qualificacao && (
                                <span className="text-muted-foreground">
                                  {' '}
                                  · {s.qualificacao}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {canAct && (
                      <div className="pt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={cnpjBusy}
                          onClick={() => applyCnpj(null)}
                        >
                          {t('cnpjDismiss')}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : lead.cnpj_match_status === 'review' &&
                  lead.cnpj_data?.candidatos?.length ? (
                  <div className="space-y-2 text-xs">
                    <p className="text-muted-foreground">
                      {t('cnpjReviewHint')}
                    </p>
                    <ul className="space-y-1.5">
                      {lead.cnpj_data.candidatos.map((c) => (
                        <li
                          key={c.cnpj}
                          className="flex items-center justify-between gap-2 rounded border p-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{c.nome}</div>
                            <div className="text-muted-foreground font-mono text-[11px]">
                              {formatCnpj(c.cnpj)} ·{' '}
                              {Math.round(c.sim * 100)}%
                              {c.mesmo_endereco ? ' · mesmo nº' : ''}
                            </div>
                          </div>
                          {canAct && cnpjConfigured && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 shrink-0 px-2 text-xs"
                              disabled={cnpjBusy}
                              onClick={() => applyCnpj(c.cnpj)}
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden />
                              {t('cnpjConfirm')}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {canAct && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={cnpjBusy}
                        onClick={() => applyCnpj(null)}
                      >
                        {t('cnpjDismiss')}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    <p className="text-muted-foreground">
                      {lead.cnpj_checked_at
                        ? t('cnpjNotFound')
                        : t('cnpjNotChecked')}
                    </p>
                    {canAct && cnpjConfigured && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={cnpjBusy}
                          onClick={lookupCnpjNow}
                        >
                          {cnpjBusy ? (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin"
                              aria-hidden
                            />
                          ) : (
                            <Building2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {cnpjBusy ? t('cnpjChecking') : t('cnpjCheckNow')}
                        </Button>
                        <div className="flex flex-1 items-center gap-1.5">
                          <Input
                            value={manualCnpj}
                            onChange={(e) =>
                              setManualInput({
                                leadId: lead.id,
                                value: e.target.value,
                              })
                            }
                            placeholder={t('cnpjManualPlaceholder')}
                            className="h-7 text-xs"
                          />
                          {manualCnpj.trim().length > 0 && (
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              disabled={cnpjBusy}
                              onClick={() => applyCnpj(manualCnpj)}
                            >
                              {t('cnpjApplyManual')}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {lead.website && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
                    <Globe className="h-3.5 w-3.5" aria-hidden />
                    {t('siteTitle')}
                  </span>
                  {canAct && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={siteBusy}
                      onClick={auditSiteNow}
                    >
                      {siteBusy && (
                        <Loader2
                          className="h-3 w-3 animate-spin"
                          aria-hidden
                        />
                      )}
                      {siteBusy ? t('siteAuditing') : t('siteAuditNow')}
                    </Button>
                  )}
                </div>

                {!lead.site_data ? (
                  <p className="text-muted-foreground text-xs">
                    {t('siteNotAudited')}
                  </p>
                ) : !lead.site_data.reachable ? (
                  <div className="space-y-1 text-xs">
                    <span className="inline-block rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-medium text-red-300">
                      {t('siteOffline')}
                      {lead.site_data.error ? ` · ${lead.site_data.error}` : ''}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-300">
                        {t('siteOnline')}
                        {lead.site_data.response_ms !== null
                          ? ` · ${lead.site_data.response_ms}ms`
                          : ''}
                      </span>
                      <span className="bg-muted rounded px-1.5 py-0.5">
                        {lead.site_data.https ? 'HTTPS' : 'HTTP'}
                      </span>
                      {lead.site_data.cms && (
                        <span className="bg-muted rounded px-1.5 py-0.5">
                          {lead.site_data.cms}
                        </span>
                      )}
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5',
                          lead.site_data.has_whatsapp
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : 'bg-amber-500/10 text-amber-300'
                        )}
                      >
                        {lead.site_data.has_whatsapp
                          ? t('siteWhatsappYes')
                          : t('siteWhatsappNo')}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {lead.site_data.pixels.meta && (
                        <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 font-medium">
                          Meta Pixel
                        </span>
                      )}
                      {lead.site_data.pixels.gtm && (
                        <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 font-medium">
                          GTM
                        </span>
                      )}
                      {lead.site_data.pixels.ga_ads && (
                        <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 font-medium">
                          Google Ads / GA4
                        </span>
                      )}
                      {lead.site_data.pixels.tiktok && (
                        <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 font-medium">
                          TikTok Pixel
                        </span>
                      )}
                      {!hasAnyAdPixel(lead.site_data.pixels) && (
                        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-300">
                          {t('siteNoPixels')}
                        </span>
                      )}
                    </div>

                    {(lead.site_data.emails.length > 0 ||
                      lead.site_data.socials.instagram ||
                      lead.site_data.socials.facebook) && (
                      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                        {lead.site_data.emails.map((em) => (
                          <span key={em}>{em}</span>
                        ))}
                        {lead.site_data.socials.instagram && (
                          <a
                            href={lead.site_data.socials.instagram}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-primary hover:underline"
                          >
                            Instagram
                          </a>
                        )}
                        {lead.site_data.socials.facebook && (
                          <a
                            href={lead.site_data.socials.facebook}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-primary hover:underline"
                          >
                            Facebook
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                  {t('funnelTitle')}
                </span>
                {hereLabel && (
                  <span className="border-primary/40 bg-primary/10 text-primary rounded-full border px-2 py-0.5 text-[11px] font-medium">
                    {hereLabel}
                  </span>
                )}
              </div>

              {pipelines && pipelines.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t('noPipelines')}{' '}
                  <Link href="/pipelines" className="text-primary underline">
                    {t('createPipeline')}
                  </Link>
                </p>
              ) : (
                <>
                  <div
                    className={cn(
                      'grid gap-2',
                      (pipelines?.length ?? 0) > 1 && 'sm:grid-cols-2'
                    )}
                  >
                    {(pipelines?.length ?? 0) > 1 && (
                      <Select
                        value={pipelineId}
                        items={(pipelines ?? []).map((p) => ({
                          value: p.id,
                          label: p.name,
                        }))}
                        onValueChange={(v) =>
                          lead &&
                          setPick({ leadId: lead.id, pipelineId: String(v) })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(pipelines ?? []).map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Select
                      value={stageId}
                      items={(pipeline?.stages ?? []).map((s) => ({
                        value: s.id,
                        label: s.name,
                      }))}
                      onValueChange={(v) =>
                        lead &&
                        setPick({
                          leadId: lead.id,
                          pipelineId,
                          stageId: String(v),
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('funnelStage')} />
                      </SelectTrigger>
                      <SelectContent>
                        {(pipeline?.stages ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={placeInFunnel}
                    disabled={
                      !canAct || placing || !stageId || !lead.phone_e164
                    }
                  >
                    {placing ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <GitBranch className="h-4 w-4" aria-hidden />
                    )}{' '}
                    {alreadyThere ? t('funnelMove') : t('funnelAdd')}
                  </Button>
                  {!lead.phone_e164 && (
                    <p className="text-muted-foreground text-xs">
                      {t('funnelNoPhone')}
                    </p>
                  )}
                </>
              )}
            </div>

            <Tabs defaultValue="message">
              <TabsList>
                <TabsTrigger value="message">{t('tabMessage')}</TabsTrigger>
                <TabsTrigger value="score">{t('tabScore')}</TabsTrigger>
              </TabsList>

              <TabsContent value="message" className="mt-4 space-y-3">
                <Select
                  value={presetId}
                  items={PLAYBOOK_PRESETS.map((p) => ({
                    value: p.id,
                    label: p.label,
                  }))}
                  onValueChange={(v) => {
                    setPresetId(String(v));
                    setEdit(null);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAYBOOK_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  rows={9}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label={t('tabMessage')}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={sendBySystem}
                    disabled={!canAct || sending || !phone || !text.trim()}
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden />
                    )}{' '}
                    {t('sendSystem')}
                  </Button>
                  <a
                    href={webUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!webUrl || !text.trim()}
                    className={cn(
                      buttonVariants({ variant: 'outline' }),
                      (!webUrl || !text.trim()) &&
                        'pointer-events-none opacity-50'
                    )}
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden />{' '}
                    {t('sendWeb')}
                  </a>
                  <Button type="button" variant="outline" onClick={copy}>
                    {t('copy')}
                  </Button>
                </div>
                {!phone && (
                  <p className="text-muted-foreground text-xs">{t('noPhone')}</p>
                )}
                <p className="text-muted-foreground text-xs">{t('sendHint')}</p>
              </TabsContent>

              <TabsContent value="score" className="mt-4">
                <ul className="divide-border divide-y text-sm">
                  {result.factors.map((f) => (
                    <li
                      key={f.label}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span>{f.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {f.points > 0 ? `+${f.points}` : f.points}
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-3 py-2 font-medium">
                    <span>{t('total')}</span>
                    <span className="text-primary tabular-nums">
                      {result.score}
                    </span>
                  </li>
                </ul>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
    {dialog}
    </>
  );
}
