'use client';

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useWhatsAppConnections } from '@/hooks/use-whatsapp-connections';
import { apiJson } from '@/lib/prospect/client';
import { VARIABLES, renderMessage } from '@/lib/prospect/campaign/message';
import { PLAYBOOK_PRESETS } from '@/lib/prospect/campaign/playbook';
import { minutesToHHMM } from '@/lib/prospect/campaign/schedule';
import type { Campaign } from '@/lib/prospect/campaign/types';
import { createClient } from '@/lib/supabase/client';

const NONE = 'none';
const DAY_KEYS = [
  'dMon',
  'dTue',
  'dWed',
  'dThu',
  'dFri',
  'dSat',
  'dSun',
] as const;
const SAMPLE = {
  nome: 'Clínica Sorriso',
  categoria: 'dentista',
  cidade: 'Belo Horizonte',
  nota: '4,8',
  avaliacoes: '120',
};

interface PipelineOption {
  id: string;
  name: string;
  stages: { id: string; name: string; position: number }[];
}
interface TemplateOption {
  name: string;
  language: string | null;
  body_text: string;
}
interface FollowUpForm {
  delayDays: string;
  text: string;
}

export interface CampaignFormInitial {
  pipelineId?: string;
  stageId?: string;
}

function messageOf(err: unknown, fallback: string) {
  return err instanceof Error && err.message !== 'error'
    ? err.message
    : fallback;
}

export function CampaignFormDialog({
  open,
  onOpenChange,
  campaign,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
  initial?: CampaignFormInitial;
  onSaved: () => void;
}) {
  const t = useTranslations('ProspectCampaigns');
  const { connections } = useWhatsAppConnections();
  const textRef = useRef<HTMLTextAreaElement>(null);

  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [name, setName] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [sentStageId, setSentStageId] = useState(NONE);
  const [replyStageId, setReplyStageId] = useState(NONE);
  const [connectionId, setConnectionId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [followups, setFollowups] = useState<FollowUpForm[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [templateVars, setTemplateVars] = useState<string[]>([]);
  const [dailyLimit, setDailyLimit] = useState('30');
  const [warmup, setWarmup] = useState(true);
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [minInterval, setMinInterval] = useState('45');
  const [maxInterval, setMaxInterval] = useState('120');
  const [includeOptout, setIncludeOptout] = useState(true);
  const [stopOnReply, setStopOnReply] = useState(true);
  const [testPhone, setTestPhone] = useState('');

  const connection = connections.find((c) => c.id === connectionId);
  const official = connection?.provider === 'meta';
  const pipeline = pipelines.find((p) => p.id === pipelineId);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    createClient()
      .from('pipelines')
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

  // Fill the form when it opens: the campaign being edited, or sensible defaults.
  useEffect(() => {
    if (!open) return;
    if (campaign) {
      setName(campaign.name);
      setPipelineId(campaign.pipeline_id);
      setStageId(campaign.stage_id);
      setSentStageId(campaign.sent_stage_id ?? NONE);
      setReplyStageId(campaign.reply_stage_id ?? NONE);
      setConnectionId(campaign.connection_id ?? '');
      setMessageText(campaign.message_text ?? '');
      setFollowups(
        campaign.followups.map((f) => ({
          delayDays: String(f.delay_days),
          text: f.text,
        }))
      );
      setTemplateName(campaign.template_name ?? '');
      setTemplateVars(campaign.template_vars);
      setDailyLimit(String(campaign.daily_limit));
      setWarmup(campaign.warmup);
      setWindowStart(minutesToHHMM(campaign.window_start_min));
      setWindowEnd(minutesToHHMM(campaign.window_end_min));
      setDays(campaign.days);
      setMinInterval(String(campaign.min_interval_s));
      setMaxInterval(String(campaign.max_interval_s));
      setIncludeOptout(campaign.include_optout);
      setStopOnReply(campaign.stop_on_reply);
    } else {
      setName('');
      setPipelineId(initial?.pipelineId ?? '');
      setStageId(initial?.stageId ?? '');
      setSentStageId(NONE);
      setReplyStageId(NONE);
      setMessageText('');
      setFollowups([]);
      setTemplateName('');
      setTemplateVars([]);
      setDailyLimit('30');
      setWarmup(true);
      setWindowStart('09:00');
      setWindowEnd('18:00');
      setDays([1, 2, 3, 4, 5]);
      setMinInterval('45');
      setMaxInterval('120');
      setIncludeOptout(true);
      setStopOnReply(true);
    }
    setTestPhone('');
  }, [open, campaign, initial?.pipelineId, initial?.stageId]);

  // Default pipeline, stage and connection once their lists have loaded.
  useEffect(() => {
    if (!open || campaign) return;
    if (!pipelineId && pipelines[0]) {
      setPipelineId(pipelines[0].id);
      setStageId(pipelines[0].stages[0]?.id ?? '');
    }
  }, [open, campaign, pipelines, pipelineId]);
  useEffect(() => {
    if (!open || connectionId || connections.length === 0) return;
    const pick = connections.find((c) => c.is_default) ?? connections[0];
    setConnectionId(pick.id);
  }, [open, connections, connectionId]);

  useEffect(() => {
    if (!open || !official) return;
    createClient()
      .from('message_templates')
      .select('name, language, body_text, status')
      .ilike('status', 'approved')
      .order('name')
      .then(({ data }) => setTemplates((data ?? []) as TemplateOption[]));
  }, [open, official]);

  const template = templates.find((x) => x.name === templateName);
  const placeholders = useMemo(
    () =>
      [
        ...new Set(
          (template?.body_text.match(/\{\{(\d+)\}\}/g) ?? []).map((m) =>
            Number(m.replace(/\D/g, ''))
          )
        ),
      ].sort((a, b) => a - b),
    [template]
  );

  const stageItems = (withNone: boolean) => [
    ...(withNone ? [{ value: NONE, label: t('fNone') }] : []),
    ...(pipeline?.stages ?? []).map((s) => ({ value: s.id, label: s.name })),
  ];

  function applyPreset(id: string) {
    const preset = PLAYBOOK_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setMessageText(preset.text);
    setFollowups(
      preset.followups.map((f) => ({
        delayDays: String(f.delay_days),
        text: f.text,
      }))
    );
  }

  function insertVariable(variable: string) {
    const el = textRef.current;
    const token = `{${variable}}`;
    if (!el) return setMessageText((m) => m + token);
    const start = el.selectionStart ?? messageText.length;
    const end = el.selectionEnd ?? messageText.length;
    setMessageText(
      messageText.slice(0, start) + token + messageText.slice(end)
    );
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function body() {
    return {
      name,
      pipelineId,
      stageId,
      sentStageId: sentStageId === NONE ? null : sentStageId,
      replyStageId: replyStageId === NONE ? null : replyStageId,
      connectionId,
      messageText: official ? null : messageText,
      templateName: official ? templateName : null,
      templateLanguage: template?.language ?? 'pt_BR',
      templateVars: official
        ? placeholders.map((_, i) => templateVars[i] ?? 'nome')
        : [],
      followups: official
        ? []
        : followups.map((f) => ({
            delayDays: Number(f.delayDays),
            text: f.text,
          })),
      includeOptout,
      stopOnReply,
      dailyLimit: Number(dailyLimit),
      warmup,
      windowStart,
      windowEnd,
      days,
      minIntervalSeconds: Number(minInterval),
      maxIntervalSeconds: Number(maxInterval),
    };
  }

  async function save(start: boolean) {
    setSaving(true);
    try {
      const saved = await apiJson<{ campaign: Campaign }>(
        campaign
          ? `/api/prospect/campaigns/${campaign.id}`
          : '/api/prospect/campaigns',
        { method: campaign ? 'PUT' : 'POST', body: JSON.stringify(body()) }
      );
      if (start) {
        await apiJson(`/api/prospect/campaigns/${saved.campaign.id}/status`, {
          method: 'POST',
          body: JSON.stringify({ action: 'start' }),
        });
      }
      toast.success(start ? t('started') : t('saved'));
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(messageOf(err, t('genericError')));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      await apiJson('/api/whatsapp/new-conversation', {
        method: 'POST',
        body: JSON.stringify({
          phone: testPhone,
          connection_id: connectionId,
          text: renderMessage(messageText, SAMPLE, () => 0, includeOptout),
        }),
      });
      toast.success(t('fTestSent'));
    } catch (err) {
      toast.error(messageOf(err, t('genericError')));
    } finally {
      setTesting(false);
    }
  }

  const preview = renderMessage(
    messageText || '',
    SAMPLE,
    () => 0,
    includeOptout
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {campaign ? t('editCampaign') : t('newCampaign')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="c-name">{t('fName')}</Label>
            <Input
              id="c-name"
              value={name}
              maxLength={80}
              placeholder={t('fNamePh')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t('fPipeline')}</Label>
              <Select
                value={pipelineId}
                items={pipelines.map((p) => ({ value: p.id, label: p.name }))}
                onValueChange={(v) => {
                  const id = String(v);
                  setPipelineId(id);
                  setStageId(
                    pipelines.find((p) => p.id === id)?.stages[0]?.id ?? ''
                  );
                  setSentStageId(NONE);
                  setReplyStageId(NONE);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('fStage')}</Label>
              <Select
                value={stageId}
                items={stageItems(false)}
                onValueChange={(v) => setStageId(String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stageItems(false).map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-muted-foreground -mt-3 text-xs">
            {t('fStageHint')}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t('fSentStage')}</Label>
              <Select
                value={sentStageId}
                items={stageItems(true)}
                onValueChange={(v) => setSentStageId(String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stageItems(true).map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('fReplyStage')}</Label>
              <Select
                value={replyStageId}
                items={stageItems(true)}
                onValueChange={(v) => setReplyStageId(String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stageItems(true).map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t('fConnection')}</Label>
            {connections.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('fNoConnections')}
              </p>
            ) : (
              <>
                <Select
                  value={connectionId}
                  items={connections.map((c) => ({
                    value: c.id,
                    label: `${c.name ?? (c.provider === 'meta' ? 'WhatsApp API' : 'WhatsApp QR')} (${c.provider === 'meta' ? 'API' : 'QR'})`,
                  }))}
                  onValueChange={(v) => setConnectionId(String(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {`${c.name ?? (c.provider === 'meta' ? 'WhatsApp API' : 'WhatsApp QR')} (${c.provider === 'meta' ? 'API' : 'QR'})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {official ? t('fConnectionMeta') : t('fConnectionQr')}
                </p>
              </>
            )}
          </div>

          {official ? (
            <div className="space-y-3">
              <div className="grid gap-2">
                <Label>{t('fTemplate')}</Label>
                {templates.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t('fTemplateNone')}
                  </p>
                ) : (
                  <Select
                    value={templateName}
                    items={templates.map((x) => ({
                      value: x.name,
                      label: x.name,
                    }))}
                    onValueChange={(v) => setTemplateName(String(v))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((x) => (
                        <SelectItem key={x.name} value={x.name}>
                          {x.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {template && (
                <p className="bg-muted/40 rounded-md border p-3 text-sm whitespace-pre-wrap">
                  {template.body_text}
                </p>
              )}
              {placeholders.map((n, i) => (
                <div key={n} className="grid gap-2">
                  <Label>{t('fTemplateVar', { index: n })}</Label>
                  <Select
                    value={templateVars[i] ?? 'nome'}
                    items={VARIABLES.map((v) => ({ value: v, label: v }))}
                    onValueChange={(v) =>
                      setTemplateVars((cur) => {
                        const next = [...cur];
                        next[i] = String(v);
                        return next;
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VARIABLES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2">
                <Label>{t('fPlaybook')}</Label>
                <Select
                  value=""
                  items={PLAYBOOK_PRESETS.map((p) => ({
                    value: p.id,
                    label: p.label,
                  }))}
                  onValueChange={(v) => applyPreset(String(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('fPlaybookPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAYBOOK_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {t('fPlaybookHint')}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-msg">{t('fMessage')}</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground text-xs">
                    {t('fVariables')}:
                  </span>
                  {VARIABLES.map((v) => (
                    <Button
                      key={v}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      onClick={() => insertVariable(v)}
                    >
                      {`{${v}}`}
                    </Button>
                  ))}
                </div>
                <Textarea
                  id="c-msg"
                  ref={textRef}
                  rows={5}
                  maxLength={1000}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {t('fMessageHint')}
                </p>
              </div>
              {messageText.trim() && (
                <div className="bg-muted/40 rounded-md border p-3">
                  <p className="mb-1 text-xs font-medium">
                    {t('fPreview')}{' '}
                    <span className="text-muted-foreground font-normal">
                      ({t('fPreviewHint')})
                    </span>
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{preview}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t('fFollowups')}</Label>
                <p className="text-muted-foreground text-xs">
                  {t('fFollowupsHint')}
                </p>
                {followups.map((f, i) => (
                  <div key={i} className="grid gap-2 rounded-md border p-3">
                    <div className="flex items-end gap-2">
                      <div className="grid w-40 gap-1">
                        <Label htmlFor={`f-delay-${i}`} className="text-xs">
                          {t('fFollowupDelay')}
                        </Label>
                        <Input
                          id={`f-delay-${i}`}
                          type="number"
                          min={1}
                          max={30}
                          value={f.delayDays}
                          onChange={(e) =>
                            setFollowups((cur) =>
                              cur.map((x, k) =>
                                k === i
                                  ? { ...x, delayDays: e.target.value }
                                  : x
                              )
                            )
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() =>
                          setFollowups((cur) => cur.filter((_, k) => k !== i))
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />{' '}
                        {t('fRemove')}
                      </Button>
                    </div>
                    <Textarea
                      rows={3}
                      maxLength={1000}
                      value={f.text}
                      aria-label={`${t('fFollowups')} ${i + 1}`}
                      onChange={(e) =>
                        setFollowups((cur) =>
                          cur.map((x, k) =>
                            k === i ? { ...x, text: e.target.value } : x
                          )
                        )
                      }
                    />
                  </div>
                ))}
                {followups.length < 2 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFollowups((cur) => [
                        ...cur,
                        { delayDays: cur.length === 0 ? '2' : '4', text: '' },
                      ])
                    }
                  >
                    <Plus className="h-4 w-4" aria-hidden /> {t('fAddFollowup')}
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-md border p-4">
            <h3 className="text-sm font-semibold">{t('fLimits')}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="c-limit">{t('fDailyLimit')}</Label>
                <Input
                  id="c-limit"
                  type="number"
                  min={1}
                  max={500}
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-from">{t('fWindowStart')}</Label>
                <Input
                  id="c-from"
                  type="time"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-to">{t('fWindowEnd')}</Label>
                <Input
                  id="c-to"
                  type="time"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t('fDays')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAY_KEYS.map((key, i) => {
                  const day = i + 1;
                  const on = days.includes(day);
                  return (
                    <Button
                      key={key}
                      type="button"
                      size="sm"
                      variant={on ? 'default' : 'outline'}
                      aria-pressed={on}
                      onClick={() =>
                        setDays((cur) =>
                          on
                            ? cur.filter((d) => d !== day)
                            : [...cur, day].sort()
                        )
                      }
                    >
                      {t(key)}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="c-min">{t('fIntervalMin')}</Label>
                <Input
                  id="c-min"
                  type="number"
                  min={10}
                  value={minInterval}
                  onChange={(e) => setMinInterval(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-max">{t('fIntervalMax')}</Label>
                <Input
                  id="c-max"
                  type="number"
                  min={10}
                  value={maxInterval}
                  onChange={(e) => setMaxInterval(e.target.value)}
                />
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              {t('fIntervalHint')}
            </p>
            <Label className="flex cursor-pointer items-center gap-2 font-normal">
              <Checkbox
                checked={warmup}
                onCheckedChange={(c) => setWarmup(Boolean(c))}
              />{' '}
              {t('fWarmup')}
            </Label>
            <Label className="flex cursor-pointer items-center gap-2 font-normal">
              <Checkbox
                checked={includeOptout}
                onCheckedChange={(c) => setIncludeOptout(Boolean(c))}
              />{' '}
              {t('fOptout')}
            </Label>
            <Label className="flex cursor-pointer items-center gap-2 font-normal">
              <Checkbox
                checked={stopOnReply}
                onCheckedChange={(c) => setStopOnReply(Boolean(c))}
              />{' '}
              {t('fStopOnReply')}
            </Label>
          </div>

          <div className="space-y-2 rounded-md border p-4">
            <h3 className="text-sm font-semibold">{t('fTest')}</h3>
            {official ? (
              <p className="text-muted-foreground text-xs">
                {t('fTestOnlyQr')}
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid flex-1 gap-1.5">
                  <Label htmlFor="c-test" className="text-xs">
                    {t('fTestPhone')}
                  </Label>
                  <Input
                    id="c-test"
                    type="tel"
                    inputMode="tel"
                    value={testPhone}
                    placeholder="31 99999-9999"
                    onChange={(e) => setTestPhone(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    testing ||
                    !testPhone.trim() ||
                    !messageText.trim() ||
                    !connectionId
                  }
                  onClick={sendTest}
                >
                  {testing && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}{' '}
                  {t('fTestSend')}
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => save(false)}
          >
            {saving ? t('saving') : t('saveDraft')}
          </Button>
          <Button disabled={saving} onClick={() => save(true)}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{' '}
            {t('saveAndStart')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
