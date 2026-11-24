import type { SupabaseClient } from '@supabase/supabase-js';

import { ProviderError } from '../types';
import { summarize, type PointResult } from './metrics';
import type { RankProvider } from './provider';
import { rankUsageKey, resolveRankProvider } from './settings';

// Runs the grid points of a scan. Runs with the service role, so every query
// is filtered by account_id. Safe to call from two places at once: a point is
// claimed with a conditional update and only the caller that wins it runs it.

export interface RankEngineDeps {
  db: SupabaseClient;
  /** Replaces the provider resolved from the account settings (tests). */
  provider?: RankProvider;
  now?: () => Date;
}

const CONCURRENCY = 5;
const STALE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

interface ScanRow {
  id: string;
  account_id: string;
  keyword: string;
  target_place_id: string;
  target_name: string;
  target_lat: number;
  target_lng: number;
  spacing_m: number;
  requests_made: number;
  status: string;
}

async function fail(db: SupabaseClient, scan: ScanRow, error: string) {
  await db
    .from('prospect_rank_scans')
    .update({ status: 'failed', error, finished_at: new Date().toISOString() })
    .eq('id', scan.id)
    .eq('account_id', scan.account_id);
}

/** Process up to `maxPoints` points of one scan. Returns true when the scan is finished. */
export async function processScan(
  scanId: string,
  deps: RankEngineDeps,
  maxPoints = 60
): Promise<boolean> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const { data: scan } = await db
    .from('prospect_rank_scans')
    .select(
      'id, account_id, keyword, target_place_id, target_name, target_lat, target_lng, spacing_m, requests_made, status'
    )
    .eq('id', scanId)
    .maybeSingle<ScanRow>();
  if (!scan || scan.status === 'done' || scan.status === 'failed') return true;

  const resolved = await resolveRankProvider(db, scan.account_id);
  const provider = deps.provider ?? resolved.provider;
  const paid = provider.id !== 'mock';
  let budget = paid ? resolved.remaining : Infinity;

  await db
    .from('prospect_rank_scans')
    .update({ status: 'running' })
    .eq('id', scan.id)
    .eq('status', 'queued');
  // points a dead worker left half-done go back to the queue
  await db
    .from('prospect_rank_points')
    .update({ status: 'queued' })
    .eq('scan_id', scan.id)
    .eq('status', 'running')
    .lt('claimed_at', new Date(now().getTime() - STALE_MS).toISOString());

  let processed = 0;
  let spent = 0;
  let stop: string | null = null;
  while (processed < maxPoints && !stop) {
    const take = Math.min(CONCURRENCY, maxPoints - processed, budget);
    if (take <= 0) {
      stop = 'Limite mensal de consultas do ranking atingido.';
      break;
    }
    const { data: queued } = await db
      .from('prospect_rank_points')
      .select('id')
      .eq('scan_id', scan.id)
      .eq('status', 'queued')
      .order('row_idx')
      .order('col_idx')
      .limit(take);
    if (!queued?.length) break;
    const { data: claimed } = await db
      .from('prospect_rank_points')
      .update({ status: 'running', claimed_at: now().toISOString() })
      .in(
        'id',
        queued.map((q) => q.id)
      )
      .eq('status', 'queued')
      .select('id, lat, lng, attempts');
    if (!claimed?.length) continue;
    processed += claimed.length;
    if (paid) budget -= claimed.length;

    await Promise.all(
      claimed.map(async (pt) => {
        try {
          const hit = await provider.rankAt({
            keyword: scan.keyword,
            lat: pt.lat as number,
            lng: pt.lng as number,
            radiusM: scan.spacing_m,
            target: {
              placeId: scan.target_place_id,
              name: scan.target_name,
              lat: scan.target_lat,
              lng: scan.target_lng,
            },
          });
          spent += hit.requests;
          await db
            .from('prospect_rank_points')
            .update({ status: 'done', rank: hit.rank, top: hit.top })
            .eq('id', pt.id)
            .eq('account_id', scan.account_id);
        } catch (err) {
          const attempts = (pt.attempts as number) + 1;
          const fatal = err instanceof ProviderError && err.status === 400;
          if (fatal) stop = (err as Error).message;
          await db
            .from('prospect_rank_points')
            .update({
              status: attempts >= MAX_ATTEMPTS || fatal ? 'failed' : 'queued',
              attempts,
            })
            .eq('id', pt.id)
            .eq('account_id', scan.account_id);
        }
      })
    );
  }

  if (spent > 0) {
    await db.rpc('prospect_add_usage_system', {
      p_account_id: scan.account_id,
      p_provider: rankUsageKey(provider.id),
      p_requests: spent,
    });
    await db
      .from('prospect_rank_scans')
      .update({ requests_made: scan.requests_made + spent })
      .eq('id', scan.id);
  }
  if (stop) {
    await fail(db, scan, stop);
    return true;
  }
  return finishIfComplete(db, scan);
}

async function finishIfComplete(
  db: SupabaseClient,
  scan: ScanRow
): Promise<boolean> {
  const { data: points } = await db
    .from('prospect_rank_points')
    .select('row_idx, col_idx, lat, lng, status, rank, top')
    .eq('scan_id', scan.id);
  const rows = (points ?? []) as PointResult[];
  const pending = rows.filter(
    (p) => p.status === 'queued' || p.status === 'running'
  );
  const s = summarize(rows);
  await db
    .from('prospect_rank_scans')
    .update({ points_done: s.done })
    .eq('id', scan.id);
  if (pending.length) return false;
  if (!s.done) {
    await fail(db, scan, 'Nenhum ponto foi medido.');
    return true;
  }
  await db
    .from('prospect_rank_scans')
    .update({
      status: 'done',
      found_count: s.found,
      top3_count: s.top3,
      avg_rank: s.avgRank,
      finished_at: new Date().toISOString(),
    })
    .eq('id', scan.id)
    .eq('account_id', scan.account_id);
  return true;
}

/** Scheduler entry: advance every open scan a little. */
export async function tickScans(
  deps: RankEngineDeps
): Promise<{ scans: number; finished: number }> {
  const { data } = await deps.db
    .from('prospect_rank_scans')
    .select('id')
    .in('status', ['queued', 'running'])
    .order('created_at')
    .limit(20);
  let finished = 0;
  for (const s of data ?? []) {
    if (await processScan(s.id as string, deps, 25)) finished += 1;
  }
  return { scans: data?.length ?? 0, finished };
}
