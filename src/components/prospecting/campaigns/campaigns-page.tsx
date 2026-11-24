'use client';

import {
  ArrowLeft,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan } from '@/hooks/use-can';
import { useWhatsAppConnections } from '@/hooks/use-whatsapp-connections';
import { apiJson } from '@/lib/prospect/client';
import { minutesToHHMM } from '@/lib/prospect/campaign/schedule';
import type { Campaign, CampaignStatus } from '@/lib/prospect/campaign/types';
import type { CampaignCounts } from '@/lib/prospect/campaign/service';
import { createClient } from '@/lib/supabase/client';
import {
  CampaignFormDialog,
  type CampaignFormInitial,
} from './campaign-form-dialog';

type CampaignRow = Campaign & { counts: CampaignCounts };

const REFRESH_MS = 10_000;

export function statusBadge(
  t: (key: string) => string,
  status: CampaignStatus
) {
  if (status === 'running') return <Badge>{t('statusRunning')}</Badge>;
  if (status === 'paused')
    return <Badge variant="outline">{t('statusPaused')}</Badge>;
  if (status === 'done')
    return <Badge variant="outline">{t('statusDone')}</Badge>;
  return <Badge variant="secondary">{t('statusDraft')}</Badge>;
}

export function pausedReason(
  t: (key: string) => string,
  reason: string | null
) {
  if (reason === 'disconnected') return t('reasonDisconnected');
  if (reason === 'errors') return t('reasonErrors');
  if (reason === 'no_connection') return t('reasonNoConnection');
  return t('reasonManual');
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground truncate text-xs">{label}</div>
    </div>
  );
}

export function CampaignsPage() {
  const t = useTranslations('ProspectCampaigns');
  const tp = useTranslations('Prospecting');
  const canAct = useCan('send-messages');
  const { connections } = useWhatsAppConnections();

  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);
  const [stageNames, setStageNames] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [initial, setInitial] = useState<CampaignFormInitial | undefined>();
  const [confirm, setConfirm] = useState<{
    kind: 'delete' | 'finish';
    campaign: CampaignRow;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiJson<{ campaigns: CampaignRow[] }>(
        '/api/prospect/campaigns'
      );
      setCampaigns(r.campaigns);
    } catch {
      setCampaigns((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    createClient()
      .from('pipelines')
      .select('name, pipeline_stages(id, name)')
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const p of data ?? []) {
          for (const s of (p.pipeline_stages ?? []) as {
            id: string;
            name: string;
          }[]) {
            map[s.id] = `${p.name} / ${s.name}`;
          }
        }
        setStageNames(map);
      });
  }, []);

  // The pipeline dialog links here with ?new=1&pipeline=...&stage=... to prefill the form.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('new') === '1') {
      setInitial({
        pipelineId: q.get('pipeline') ?? undefined,
        stageId: q.get('stage') ?? undefined,
      });
      setEditing(null);
      setFormOpen(true);
    }
  }, []);

  async function act(c: CampaignRow, action: 'start' | 'pause' | 'finish') {
    setBusy(c.id);
    try {
      await apiJson(`/api/prospect/campaigns/${c.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message !== 'error'
          ? err.message
          : t('genericError')
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(c: CampaignRow) {
    setBusy(c.id);
    try {
      await apiJson(`/api/prospect/campaigns/${c.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message !== 'error'
          ? err.message
          : t('genericError')
      );
    } finally {
      setBusy(null);
    }
  }

  const connectionName = (id: string | null) => {
    const c = connections.find((x) => x.id === id);
    return c
      ? (c.name ?? (c.provider === 'meta' ? 'WhatsApp API' : 'WhatsApp QR'))
      : '-';
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/prospecting"
            className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('backToLeads')}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            {t('subtitle')}
          </p>
        </div>
        <Button
          disabled={!canAct}
          onClick={() => {
            setEditing(null);
            setInitial(undefined);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden /> {t('newCampaign')}
        </Button>
      </div>

      {campaigns === null ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        </p>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground pt-6 text-sm">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        campaigns.map((c) => {
          const running = c.status === 'running';
          const working = busy === c.id;
          return (
            <Card key={c.id}>
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/prospecting/campaigns/${c.id}`}
                      className="block truncate text-lg font-semibold hover:underline"
                    >
                      {c.name}
                    </Link>
                    <p className="text-muted-foreground text-sm">
                      {t('cardStage', { stage: stageNames[c.stage_id] ?? '-' })}{' '}
                      ·{' '}
                      {t('cardConnection', {
                        name: connectionName(c.connection_id),
                      })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t('pace', {
                        limit: c.daily_limit,
                        start: minutesToHHMM(c.window_start_min),
                        end: minutesToHHMM(c.window_end_min),
                      })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {statusBadge(t, c.status)}
                    {c.status === 'paused' && (
                      <span className="text-muted-foreground text-xs">
                        {pausedReason(t, c.paused_reason)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  <Stat label={t('countQueued')} value={c.counts.queued} />
                  <Stat
                    label={t('countContacted')}
                    value={c.counts.contacted}
                  />
                  <Stat label={t('countReplied')} value={c.counts.replied} />
                  <Stat label={t('countOptedOut')} value={c.counts.opted_out} />
                  <Stat label={t('countFailed')} value={c.counts.failed} />
                </div>
                {running && (
                  <p className="text-muted-foreground text-xs">
                    {t('today', {
                      sent: c.counts.sentToday,
                      cap: c.daily_limit,
                    })}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {c.status !== 'done' && !running && (
                    <Button
                      size="sm"
                      disabled={!canAct || working}
                      onClick={() => act(c, 'start')}
                    >
                      <Play className="h-4 w-4" aria-hidden />{' '}
                      {c.status === 'paused' ? t('resume') : t('start')}
                    </Button>
                  )}
                  {running && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canAct || working}
                      onClick={() => act(c, 'pause')}
                    >
                      <Pause className="h-4 w-4" aria-hidden /> {t('pause')}
                    </Button>
                  )}
                  {c.status !== 'done' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canAct || working}
                      onClick={() =>
                        setConfirm({ kind: 'finish', campaign: c })
                      }
                    >
                      <Square className="h-4 w-4" aria-hidden /> {t('finish')}
                    </Button>
                  )}
                  {!running && c.status !== 'done' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canAct}
                      onClick={() => {
                        setEditing(c);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" aria-hidden /> {t('edit')}
                    </Button>
                  )}
                  <Link
                    href={`/prospecting/campaigns/${c.id}`}
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  >
                    {t('details')}
                  </Link>
                  {!running && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canAct || working}
                      onClick={() =>
                        setConfirm({ kind: 'delete', campaign: c })
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden /> {t('delete')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <CampaignFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        campaign={editing}
        initial={initial}
        onSaved={() => void load()}
      />

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === 'delete' ? t('delete') : t('finish')}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'delete'
                ? t('deleteConfirm')
                : t('confirmFinish')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {tp('cancel')}
            </Button>
            <Button
              variant={confirm?.kind === 'delete' ? 'destructive' : 'default'}
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                if (!c) return;
                if (c.kind === 'delete') void remove(c.campaign);
                else void act(c.campaign, 'finish');
              }}
            >
              {confirm?.kind === 'delete' ? t('delete') : t('finish')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
