'use client';

import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCan } from '@/hooks/use-can';
import { apiJson } from '@/lib/prospect/client';
import { GRID_SIZES, SPACINGS_M } from '@/lib/prospect/rank/grid';
import type { LeadRow } from '@/lib/prospect/types';

interface ScanRow {
  id: string;
  target_name: string;
  keyword: string;
  grid_size: number;
  spacing_m: number;
  provider: 'google' | 'mock';
  status: 'queued' | 'running' | 'done' | 'failed';
  points_total: number;
  points_done: number;
  top3_count: number | null;
  found_count: number | null;
  avg_rank: number | null;
  created_at: string;
}

export function scanStatusBadge(
  t: (key: string) => string,
  status: ScanRow['status']
) {
  if (status === 'done')
    return <Badge variant="outline">{t('statusDone')}</Badge>;
  if (status === 'failed')
    return <Badge variant="destructive">{t('statusFailed')}</Badge>;
  return (
    <Badge>
      {status === 'running' ? t('statusRunning') : t('statusQueued')}
    </Badge>
  );
}

function NewScanDialog({
  open,
  onOpenChange,
  initialLeadId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLeadId: string | null;
}) {
  const t = useTranslations('ProspectRank');
  const [term, setTerm] = useState('');
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [keyword, setKeyword] = useState('');
  const [size, setSize] = useState('5');
  const [spacing, setSpacing] = useState('1000');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ pageSize: '25', status: 'all' });
      if (term.trim()) params.set('q', term.trim());
      apiJson<{ leads: LeadRow[] }>(`/api/prospect/leads?${params}`)
        .then((r) => setLeads(r.leads.filter((l) => l.lat !== null)))
        .catch(() => setLeads([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [open, term]);

  useEffect(() => {
    if (!open || !initialLeadId || lead) return;
    apiJson<{ leads: LeadRow[] }>(`/api/prospect/leads?pageSize=100&status=all`)
      .then((r) => {
        const found = r.leads.find((l) => l.id === initialLeadId);
        if (found) {
          setLead(found);
          setKeyword(found.category?.replace(/_/g, ' ') ?? '');
        }
      })
      .catch(() => undefined);
  }, [open, initialLeadId, lead]);

  async function submit() {
    if (!lead) return;
    setBusy(true);
    try {
      const { id } = await apiJson<{ id: string }>('/api/prospect/rank/scans', {
        method: 'POST',
        body: JSON.stringify({
          leadId: lead.id,
          keyword,
          gridSize: Number(size),
          spacingM: Number(spacing),
        }),
      });
      window.location.href = `/prospecting/ranking/${id}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('createFailed'));
      setBusy(false);
    }
  }

  const points = Number(size) ** 2;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('newScan')}</DialogTitle>
          <DialogDescription>{t('newScanHelp')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t('fBusiness')}</Label>
            {lead ? (
              <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <span className="truncate">{lead.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setLead(null)}>
                  {t('change')}
                </Button>
              </div>
            ) : (
              <>
                <Input
                  value={term}
                  placeholder={t('searchBusiness')}
                  onChange={(e) => setTerm(e.target.value)}
                />
                <div className="max-h-40 overflow-y-auto rounded-md border">
                  {leads.length === 0 && (
                    <p className="text-muted-foreground p-2 text-sm">
                      {t('noBusinesses')}
                    </p>
                  )}
                  {leads.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="hover:bg-muted block w-full truncate px-2 py-1.5 text-left text-sm"
                      onClick={() => {
                        setLead(l);
                        if (!keyword)
                          setKeyword(l.category?.replace(/_/g, ' ') ?? '');
                      }}
                    >
                      {l.name}
                      {l.city ? ` · ${l.city}` : ''}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rank-keyword">{t('fKeyword')}</Label>
            <Input
              id="rank-keyword"
              value={keyword}
              maxLength={80}
              placeholder={t('keywordPlaceholder')}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t('fGrid')}</Label>
              <Select
                value={size}
                items={GRID_SIZES.map((g) => ({
                  value: String(g),
                  label: `${g} x ${g}`,
                }))}
                onValueChange={(v) => setSize(String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRID_SIZES.map((g) => (
                    <SelectItem key={g} value={String(g)}>
                      {g} x {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('fSpacing')}</Label>
              <Select
                value={spacing}
                items={SPACINGS_M.map((m) => ({
                  value: String(m),
                  label: t('meters', { m }),
                }))}
                onValueChange={(v) => setSpacing(String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPACINGS_M.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {t('meters', { m })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {t('estimate', { n: points })}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            disabled={busy || !lead || keyword.trim().length < 2}
            onClick={submit}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? t('measuring') : t('startScan')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RankingPage({ leadId }: { leadId: string | null }) {
  const t = useTranslations('ProspectRank');
  const locale = useLocale();
  const canAct = useCan('send-messages');
  const [scans, setScans] = useState<ScanRow[] | null>(null);
  const [open, setOpen] = useState(Boolean(leadId));

  const load = useCallback(async () => {
    const r = await apiJson<{ scans: ScanRow[] }>('/api/prospect/rank/scans');
    setScans(r.scans);
  }, []);

  useEffect(() => {
    load().catch(() => setScans([]));
  }, [load]);

  useEffect(() => {
    if (!scans?.some((s) => s.status === 'queued' || s.status === 'running'))
      return;
    const id = setInterval(() => load().catch(() => undefined), 5000);
    return () => clearInterval(id);
  }, [scans, load]);

  async function remove(id: string) {
    if (!window.confirm(t('deleteConfirm'))) return;
    await apiJson(`/api/prospect/rank/scans/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/prospecting"
            className={buttonVariants({ variant: 'outline' })}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('backToLeads')}
          </Link>
          {canAct && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('newScan')}
            </Button>
          )}
        </div>
      </div>

      {scans === null && (
        <Loader2
          className="text-muted-foreground h-5 w-5 animate-spin"
          aria-hidden
        />
      )}
      {scans?.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      )}
      <div className="grid gap-3">
        {scans?.map((s) => (
          <Card key={s.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="min-w-0">
                <Link
                  href={`/prospecting/ranking/${s.id}`}
                  className="font-medium hover:underline"
                >
                  {s.target_name}
                </Link>
                <div className="text-muted-foreground text-xs">
                  {s.keyword} · {s.grid_size} x {s.grid_size} ·{' '}
                  {t('meters', { m: s.spacing_m })} ·{' '}
                  {new Date(s.created_at).toLocaleString(locale)}
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                {s.status === 'done' ? (
                  <>
                    <span className="tabular-nums">
                      {t('top3Of', {
                        n: s.top3_count ?? 0,
                        total: s.points_done,
                      })}
                    </span>
                    <span className="tabular-nums">
                      {t('avgShort', {
                        n: s.avg_rank === null ? '-' : String(s.avg_rank),
                      })}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground tabular-nums">
                    {t('points', {
                      done: s.points_done,
                      total: s.points_total,
                    })}
                  </span>
                )}
                {scanStatusBadge(t, s.status)}
                {canAct && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('delete')}
                    title={t('delete')}
                    onClick={() => remove(s.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <NewScanDialog
        open={open}
        onOpenChange={setOpen}
        initialLeadId={leadId}
      />
    </div>
  );
}
