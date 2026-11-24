'use client';

import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiJson } from '@/lib/prospect/client';
import { buildView } from '@/lib/prospect/rank/map';
import {
  rankTone,
  type Competitor,
  type PointResult,
  type RankTone,
  type ScanSummary,
} from '@/lib/prospect/rank/metrics';
import { scanStatusBadge } from './ranking-page';

interface Detail {
  scan: {
    id: string;
    target_name: string;
    target_lat: number;
    target_lng: number;
    keyword: string;
    grid_size: number;
    spacing_m: number;
    provider: 'google' | 'mock';
    status: 'queued' | 'running' | 'done' | 'failed';
    error: string | null;
    points_total: number;
    created_at: string;
  };
  points: PointResult[];
  summary: ScanSummary;
  competitors: Competitor[];
  change: { avgRankDelta: number | null; top3ShareDelta: number | null } | null;
}

const MAP_SIZE = 560;

const TONE: Record<RankTone, string> = {
  top: 'bg-emerald-500 text-white',
  good: 'bg-amber-400 text-black',
  low: 'bg-red-500 text-white',
  none: 'bg-zinc-400 text-white',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-muted-foreground text-xs">{label}</div>
      </CardContent>
    </Card>
  );
}

export function RankingDetail({ id }: { id: string }) {
  const t = useTranslations('ProspectRank');
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const d = await apiJson<Detail>(`/api/prospect/rank/scans/${id}`);
        if (stop) return;
        setData(d);
        if (d.scan.status === 'queued' || d.scan.status === 'running')
          timer = setTimeout(load, 4000);
      } catch {
        if (!stop) setError(true);
      }
    };
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  const view = useMemo(() => {
    if (!data) return null;
    const { scan } = data;
    const extent = (scan.grid_size + 1) * scan.spacing_m;
    return buildView(scan.target_lat, scan.target_lng, extent, MAP_SIZE);
  }, [data]);

  if (error) return <p className="text-sm">{t('notFound')}</p>;
  if (!data || !view)
    return (
      <Loader2
        className="text-muted-foreground h-5 w-5 animate-spin"
        aria-hidden
      />
    );

  const { scan, summary, change } = data;
  const center = view.project(scan.target_lat, scan.target_lng);
  const delta = (n: number | null, unit = '') =>
    n === null ? '-' : `${n > 0 ? '+' : ''}${n}${unit}`;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {scan.target_name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {scan.keyword} · {scan.grid_size} x {scan.grid_size} ·{' '}
            {t('meters', { m: scan.spacing_m })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {scanStatusBadge(t, scan.status)}
          <Link
            href="/prospecting/ranking"
            className={buttonVariants({ variant: 'outline' })}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('backToList')}
          </Link>
        </div>
      </div>

      {scan.status === 'failed' && (
        <Alert variant="destructive">
          <AlertDescription>
            {t('failed', { error: scan.error ?? '' })}
          </AlertDescription>
        </Alert>
      )}
      {(scan.status === 'queued' || scan.status === 'running') && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('points', { done: summary.done, total: scan.points_total })}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('statFound')} value={`${summary.foundShare}%`} />
        <Stat label={t('statTop3')} value={`${summary.top3Share}%`} />
        <Stat
          label={t('statAvg')}
          value={summary.avgRank === null ? '-' : String(summary.avgRank)}
        />
      </div>
      {change && (
        <p className="text-muted-foreground text-sm">
          {t('vsPrevious', {
            avg: delta(change.avgRankDelta),
            top3: delta(change.top3ShareDelta, ' pp'),
          })}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <div
          className="relative max-w-full overflow-hidden rounded-lg border"
          style={{ width: MAP_SIZE, height: MAP_SIZE }}
          role="img"
          aria-label={t('mapLabel')}
        >
          {view.tiles.map((tile) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={tile.key}
              src={`https://tile.openstreetmap.org/${view.zoom}/${tile.x}/${tile.y}.png`}
              alt=""
              width={256}
              height={256}
              draggable={false}
              className="absolute max-w-none"
              style={{ left: tile.left, top: tile.top }}
            />
          ))}
          <span
            className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-600"
            style={{ left: center.x, top: center.y }}
            title={scan.target_name}
          />
          {data.points.map((p) => {
            const pos = view.project(p.lat, p.lng);
            const tone = p.status === 'done' ? rankTone(p.rank) : 'none';
            const label =
              p.status !== 'done'
                ? '…'
                : p.rank === null
                  ? '20+'
                  : String(p.rank);
            return (
              <span
                key={`${p.row_idx}-${p.col_idx}`}
                className={`absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-semibold shadow ${TONE[tone]} ${p.status === 'done' ? '' : 'opacity-40'}`}
                style={{ left: pos.x, top: pos.y }}
                title={
                  p.status === 'done'
                    ? p.top
                        .map((x, i) => `${i + 1}. ${x.name ?? x.id}`)
                        .join('\n')
                    : undefined
                }
              >
                {label}
              </span>
            );
          })}
          <span className="absolute right-1 bottom-1 rounded bg-white/80 px-1 text-[10px] text-black">
            © OpenStreetMap
          </span>
        </div>

        <div className="space-y-4">
          <ul className="flex flex-wrap gap-3 text-xs">
            {(['top', 'good', 'low', 'none'] as RankTone[]).map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className={`h-3 w-3 rounded-full ${TONE[k]}`} />
                {t(`legend_${k}`)}
              </li>
            ))}
          </ul>
          <div>
            <h2 className="mb-2 text-sm font-medium">{t('competitors')}</h2>
            {data.competitors.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('noCompetitors')}
              </p>
            ) : (
              <ol className="space-y-1 text-sm">
                {data.competitors.map((c) => (
                  <li key={c.id} className="flex justify-between gap-3">
                    <span className="truncate">{c.name ?? t('unnamed')}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {t('appearances', { n: c.appearances })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
