// Numbers shown for a scan: how often the business appears, how high, and who is in front.

export interface TopEntry {
  id: string;
  name?: string;
}

export interface PointResult {
  row_idx: number;
  col_idx: number;
  lat: number;
  lng: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  rank: number | null;
  top: TopEntry[];
}

export interface ScanSummary {
  total: number;
  done: number;
  /** Points where the business showed up in the first results. */
  found: number;
  /** Points where it showed up in the top 3. */
  top3: number;
  foundShare: number;
  top3Share: number;
  /** Average position over the points where it was found. */
  avgRank: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarize(points: PointResult[]): ScanSummary {
  const done = points.filter((p) => p.status === 'done');
  const ranks = done.map((p) => p.rank).filter((r): r is number => r !== null);
  const share = (n: number) =>
    done.length ? Math.round((n / done.length) * 1000) / 10 : 0;
  return {
    total: points.length,
    done: done.length,
    found: ranks.length,
    top3: ranks.filter((r) => r <= 3).length,
    foundShare: share(ranks.length),
    top3Share: share(ranks.filter((r) => r <= 3).length),
    avgRank: ranks.length
      ? round1(ranks.reduce((a, b) => a + b, 0) / ranks.length)
      : null,
  };
}

export type RankTone = 'top' | 'good' | 'low' | 'none';

/** 1-3 strong, 4-10 good, 11 or worse low, not found none. */
export function rankTone(rank: number | null): RankTone {
  if (rank === null) return 'none';
  if (rank <= 3) return 'top';
  if (rank <= 10) return 'good';
  return 'low';
}

export interface Competitor {
  id: string;
  name: string | null;
  /** Points where it was among the top 3. */
  appearances: number;
}

/** Businesses that most often beat the target (top 3 appearances), most frequent first. */
export function topCompetitors(
  points: PointResult[],
  targetPlaceId: string,
  limit = 8
): Competitor[] {
  const seen = new Map<string, Competitor>();
  for (const p of points) {
    if (p.status !== 'done') continue;
    for (const entry of p.top.slice(0, 3)) {
      if (entry.id === targetPlaceId) continue;
      const current = seen.get(entry.id) ?? {
        id: entry.id,
        name: entry.name ?? null,
        appearances: 0,
      };
      current.appearances += 1;
      if (!current.name && entry.name) current.name = entry.name;
      seen.set(entry.id, current);
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, limit);
}

/** Positive = better than the previous scan (lower average position, more top 3). */
export function compareWithPrevious(
  previous: {
    avg_rank: number | null;
    top3_count: number | null;
    points_done: number;
  } | null,
  current: ScanSummary
): { avgRankDelta: number | null; top3ShareDelta: number | null } | null {
  if (!previous || !previous.points_done) return null;
  const prevShare =
    previous.top3_count !== null
      ? (previous.top3_count / previous.points_done) * 100
      : null;
  return {
    avgRankDelta:
      previous.avg_rank !== null && current.avgRank !== null
        ? round1(previous.avg_rank - current.avgRank)
        : null,
    top3ShareDelta:
      prevShare !== null ? round1(current.top3Share - prevShare) : null,
  };
}
