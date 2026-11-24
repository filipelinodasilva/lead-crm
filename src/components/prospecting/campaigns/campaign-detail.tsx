'use client';

import { ArrowLeft, Loader2, Pause, Play, Square } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCan } from '@/hooks/use-can';
import { apiJson } from '@/lib/prospect/client';
import { minutesToHHMM } from '@/lib/prospect/campaign/schedule';
import type { CampaignCounts } from '@/lib/prospect/campaign/service';
import type { Campaign, Recipient } from '@/lib/prospect/campaign/types';
import { pausedReason, statusBadge } from './campaigns-page';

type CampaignRow = Campaign & { counts: CampaignCounts };
type RecipientRow = Recipient & {
  contact_name: string | null;
  contact_phone: string | null;
};

const ALL = 'all';
const STATUS_KEYS = {
  queued: 'rQueued',
  sent: 'rSent',
  replied: 'rReplied',
  opted_out: 'rOptedOut',
  failed: 'rFailed',
  skipped: 'rSkipped',
} as const;

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '-';
}

export function CampaignDetail({ id }: { id: string }) {
  const t = useTranslations('ProspectCampaigns');
  const tp = useTranslations('Prospecting');
  const canAct = useCan('send-messages');

  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [rows, setRows] = useState<RecipientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(ALL);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        apiJson<{ campaign: CampaignRow }>(`/api/prospect/campaigns/${id}`),
        apiJson<{ recipients: RecipientRow[]; total: number }>(
          `/api/prospect/campaigns/${id}/recipients?page=${page}${status === ALL ? '' : `&status=${status}`}`
        ),
      ]);
      setCampaign(c.campaign);
      setRows(r.recipients);
      setTotal(r.total);
    } catch {
      toast.error(t('genericError'));
    }
  }, [id, page, status, t]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(action: 'start' | 'pause' | 'finish') {
    setBusy(true);
    try {
      await apiJson(`/api/prospect/campaigns/${id}/status`, {
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
      setBusy(false);
    }
  }

  if (!campaign) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </p>
    );
  }
  const running = campaign.status === 'running';
  const pages = Math.max(1, Math.ceil(total / 50));
  const c = campaign.counts;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <Link
          href="/prospecting/campaigns"
          className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('title')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {campaign.name}
          </h1>
          {statusBadge(t, campaign.status)}
          {campaign.status === 'paused' && (
            <span className="text-muted-foreground text-sm">
              {pausedReason(t, campaign.paused_reason)}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-sm">
          {t('pace', {
            limit: campaign.daily_limit,
            start: minutesToHHMM(campaign.window_start_min),
            end: minutesToHHMM(campaign.window_end_min),
          })}
          {running &&
            ` · ${t('today', { sent: c.sentToday, cap: campaign.daily_limit })}`}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {campaign.status !== 'done' && !running && (
          <Button
            size="sm"
            disabled={!canAct || busy}
            onClick={() => act('start')}
          >
            <Play className="h-4 w-4" aria-hidden />{' '}
            {campaign.status === 'paused' ? t('resume') : t('start')}
          </Button>
        )}
        {running && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canAct || busy}
            onClick={() => act('pause')}
          >
            <Pause className="h-4 w-4" aria-hidden /> {t('pause')}
          </Button>
        )}
        {campaign.status !== 'done' && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canAct || busy}
            onClick={() => act('finish')}
          >
            <Square className="h-4 w-4" aria-hidden /> {t('finish')}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          [t('countQueued'), c.queued],
          [t('countContacted'), c.contacted],
          [t('countReplied'), c.replied],
          [t('countOptedOut'), c.opted_out],
          [t('countFailed'), c.failed],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardContent className="pt-4">
              <div className="text-2xl font-semibold tabular-nums">
                {value as number}
              </div>
              <div className="text-muted-foreground text-xs">
                {label as string}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">{t('recipients')}</h2>
            <Select
              value={status}
              items={[
                { value: ALL, label: t('filterAll') },
                ...Object.entries(STATUS_KEYS).map(([k, key]) => ({
                  value: k,
                  label: t(key),
                })),
              ]}
              onValueChange={(v) => {
                setStatus(String(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filterAll')}</SelectItem>
                {Object.entries(STATUS_KEYS).map(([k, key]) => (
                  <SelectItem key={k} value={k}>
                    {t(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {rows.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              {t('noRecipients')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colContact')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    {t('colLast')}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('colDetail')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.contact_name ?? '-'}</div>
                      <div className="text-muted-foreground text-xs">
                        {r.contact_phone}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === 'failed'
                            ? 'destructive'
                            : r.status === 'replied'
                              ? 'default'
                              : 'secondary'
                        }
                      >
                        {t(STATUS_KEYS[r.status])}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-sm whitespace-nowrap sm:table-cell">
                      {when(r.last_sent_at)}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground hidden max-w-xs truncate text-sm md:table-cell"
                      title={r.error ?? undefined}
                    >
                      {r.error ?? ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-end gap-2 border-t px-4 py-3 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {tp('prev')}
            </Button>
            <span className="text-muted-foreground">
              {tp('pageOf', { page, pages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              {tp('next')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
