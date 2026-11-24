import type { LeadStatus } from './types';

// Lead filters shared by the list, the "select all N" id lookup and the CSV
// export, so all three always agree on what "the filtered leads" means.

export type CnpjFilter = 'matched' | 'review' | 'unchecked';

export interface LeadFilters {
  q?: string;
  category?: string;
  city?: string;
  website?: 'with' | 'without';
  cnpj?: CnpjFilter;
  minReviews?: number;
  minRating?: number;
  mobileOnly?: boolean;
  /** Omitted = everything except discarded. */
  status?: LeadStatus | 'all';
  searchId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

function text(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim().slice(0, max);
  return t || undefined;
}

/** Validate untrusted input (query string or JSON body) into a filter object. */
export function parseLeadFilters(input: unknown): LeadFilters {
  const src: Record<string, unknown> =
    input instanceof URLSearchParams
      ? Object.fromEntries(input.entries())
      : input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {};

  const f: LeadFilters = {};
  const q = text(src.q);
  if (q) f.q = q;
  const category = text(src.category);
  if (category) f.category = category;
  const city = text(src.city);
  if (city) f.city = city;
  if (src.website === 'with' || src.website === 'without')
    f.website = src.website;
  if (
    src.cnpj === 'matched' ||
    src.cnpj === 'review' ||
    src.cnpj === 'unchecked'
  ) {
    f.cnpj = src.cnpj;
  }
  const minReviews = num(src.minReviews, 0, 1_000_000);
  if (minReviews !== undefined) f.minReviews = Math.floor(minReviews);
  const minRating = num(src.minRating, 0, 5);
  if (minRating !== undefined) f.minRating = minRating;
  if (
    src.mobileOnly === true ||
    src.mobileOnly === 'true' ||
    src.mobileOnly === '1'
  ) {
    f.mobileOnly = true;
  }
  if (
    src.status === 'new' ||
    src.status === 'in_pipeline' ||
    src.status === 'discarded' ||
    src.status === 'all'
  ) {
    f.status = src.status;
  }
  if (typeof src.searchId === 'string' && UUID.test(src.searchId))
    f.searchId = src.searchId;
  return f;
}

/** The slice of the Supabase query builder the filters need. */
interface FilterBuilder {
  eq(column: string, value: unknown): this;
  neq(column: string, value: unknown): this;
  gte(column: string, value: unknown): this;
  ilike(column: string, pattern: string): this;
  is(column: string, value: null): this;
  not(column: string, operator: string, value: unknown): this;
  or(filters: string): this;
}

/** Characters that would break a PostgREST `or(...)` expression or act as wildcards. */
const unsafeForOr = /[,()%*\\]/g;

export function applyLeadFilters<Q>(query: Q, f: LeadFilters): Q {
  // Cast on purpose: the PostgREST builder types are too deep for TypeScript to compare.
  let q = query as unknown as FilterBuilder;
  if (f.searchId) q = q.eq('search_id', f.searchId);
  if (f.category) q = q.eq('category', f.category);
  if (f.city) q = q.ilike('city', `%${f.city.replace(unsafeForOr, ' ')}%`);
  if (f.website === 'with') q = q.not('website', 'is', null);
  if (f.website === 'without') q = q.is('website', null);
  if (f.cnpj === 'matched') q = q.eq('cnpj_match_status', 'matched');
  if (f.cnpj === 'review') q = q.eq('cnpj_match_status', 'review');
  if (f.cnpj === 'unchecked') q = q.is('cnpj_checked_at', null);
  if (f.minReviews) q = q.gte('review_count', f.minReviews);
  if (f.minRating) q = q.gte('rating', f.minRating);
  if (f.mobileOnly) q = q.eq('phone_kind', 'mobile');
  if (f.q) {
    const term = f.q.replace(unsafeForOr, ' ').trim();
    if (term) q = q.or(`name.ilike.%${term}%,address.ilike.%${term}%`);
  }
  if (f.status === undefined) q = q.neq('status', 'discarded');
  else if (f.status !== 'all') q = q.eq('status', f.status);
  return q as unknown as Q;
}
