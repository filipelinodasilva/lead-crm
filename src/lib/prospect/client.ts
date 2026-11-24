// Browser-side helpers for the prospecting screens.

import type { LeadFilters } from './filters';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      typeof data?.error === 'string' ? data.error : 'error',
      res.status,
      typeof data?.code === 'string' ? data.code : undefined
    );
  }
  return data as T;
}

export const ACTION_CHUNK = 100;

/**
 * POST a long id list in chunks (the server caps one call at 200 ids) and
 * report progress, so "select all 600" is a visible, interruptible job
 * instead of one request that may time out.
 */
export async function postInChunks<T>(
  url: string,
  ids: string[],
  extra: Record<string, unknown>,
  onProgress: (done: number, total: number) => void,
  shouldStop: () => boolean = () => false
): Promise<T[]> {
  const results: T[] = [];
  onProgress(0, ids.length);
  for (let i = 0; i < ids.length; i += ACTION_CHUNK) {
    if (shouldStop()) break;
    const slice = ids.slice(i, i + ACTION_CHUNK);
    results.push(
      await apiJson<T>(url, {
        method: 'POST',
        body: JSON.stringify({ ...extra, ids: slice }),
      })
    );
    onProgress(Math.min(i + slice.length, ids.length), ids.length);
  }
  return results;
}

/** Filters → query string, the inverse of `parseLeadFilters`. */
export function filtersToParams(f: LeadFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.category) p.set('category', f.category);
  if (f.city) p.set('city', f.city);
  if (f.website) p.set('website', f.website);
  if (f.cnpj) p.set('cnpj', f.cnpj);
  if (f.minReviews) p.set('minReviews', String(f.minReviews));
  if (f.minRating) p.set('minRating', String(f.minRating));
  if (f.mobileOnly) p.set('mobileOnly', '1');
  if (f.status) p.set('status', f.status);
  if (f.searchId) p.set('searchId', f.searchId);
  return p;
}

export function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((n, item) => n + pick(item), 0);
}
