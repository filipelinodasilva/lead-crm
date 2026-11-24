import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { createGoogleProvider } from './google';
import { createGosomProvider } from './gosom';
import { createMockProvider } from './mock';
import { ProspectError, type PlacesProvider } from './types';

export const DEFAULT_MONTHLY_CAP = 900;
export const DEFAULT_RANK_CAP = 500;

export interface ProspectSettings {
  googleApiKey: string | null;
  monthlyRequestCap: number;
  rankRequestCap: number;
  dataforseoLogin: string | null;
  dataforseoPassword: string | null;
  rankProvider: 'auto' | 'google' | 'dataforseo';
  webhookUrl: string | null;
  webhookSecret: string | null;
}

/** Decrypted settings. Server-side only: never send this object to the browser. */
export async function loadSettings(
  db: SupabaseClient,
  accountId: string
): Promise<ProspectSettings> {
  const { data } = await db
    .from('prospect_settings')
    .select(
      'google_api_key, monthly_request_cap, rank_request_cap, dataforseo_login, dataforseo_password, rank_provider, webhook_url, webhook_secret'
    )
    .eq('account_id', accountId)
    .maybeSingle();
  return {
    googleApiKey: data?.google_api_key
      ? decrypt(data.google_api_key as string)
      : null,
    monthlyRequestCap:
      (data?.monthly_request_cap as number | undefined) ?? DEFAULT_MONTHLY_CAP,
    rankRequestCap:
      (data?.rank_request_cap as number | undefined) ?? DEFAULT_RANK_CAP,
    dataforseoLogin:
      (data?.dataforseo_login as string | null | undefined) ?? null,
    dataforseoPassword: data?.dataforseo_password
      ? decrypt(data.dataforseo_password as string)
      : null,
    rankProvider:
      (data?.rank_provider as 'auto' | 'google' | 'dataforseo' | undefined) ??
      'auto',
    webhookUrl: (data?.webhook_url as string | null | undefined) ?? null,
    webhookSecret: data?.webhook_secret
      ? decrypt(data.webhook_secret as string)
      : null,
  };
}

/** First day of the month in UTC, matching `prospect_usage.month`. */
export function monthStart(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function loadUsage(
  db: SupabaseClient,
  accountId: string,
  provider: string = 'google'
): Promise<number> {
  const { data } = await db
    .from('prospect_usage')
    .select('requests')
    .eq('account_id', accountId)
    .eq('month', monthStart())
    .eq('provider', provider)
    .maybeSingle();
  return (data?.requests as number | undefined) ?? 0;
}

export interface ResolvedProvider {
  provider: PlacesProvider;
  /**
   * Where the engine comes from: the account's own Google key, the server's
   * Google key, the free engine (gosom), or `none` (only when the test
   * provider is forced with `PROSPECT_PROVIDER=mock`, used by the tests).
   */
  keySource: 'account' | 'server' | 'engine' | 'none';
  cap: number;
  used: number;
  remaining: number;
}

export const DEFAULT_GOSOM_CAP = 300;

/**
 * Pick the search engine: the free engine (gosom) when `PROSPECT_GOSOM_URL`
 * is set, else a Google Places key (the account's own, else the server's).
 * `PROSPECT_PROVIDER=google` skips the free engine; `PROSPECT_PROVIDER=mock`
 * forces the test provider (automated tests only). With nothing configured
 * the search fails with a clear message instead of inventing businesses.
 */
export async function resolveProvider(
  db: SupabaseClient,
  accountId: string,
  env: Record<string, string | undefined> = process.env
): Promise<ResolvedProvider> {
  const settings = await loadSettings(db, accountId);

  if (env.PROSPECT_PROVIDER === 'mock') {
    return {
      provider: createMockProvider(),
      keySource: 'none',
      cap: settings.monthlyRequestCap,
      used: 0,
      remaining: Number.MAX_SAFE_INTEGER,
    };
  }

  const gosomUrl = env.PROSPECT_GOSOM_URL?.trim();
  if (gosomUrl && env.PROSPECT_PROVIDER !== 'google') {
    const asked = Number(env.PROSPECT_GOSOM_MONTHLY_CAP);
    const gosomCap =
      Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : DEFAULT_GOSOM_CAP;
    const used = await loadUsage(db, accountId, 'gosom');
    return {
      provider: createGosomProvider(gosomUrl, {
        timeoutSec: Number(env.PROSPECT_TIMEOUT_SEC) || undefined,
      }),
      keySource: 'engine',
      cap: gosomCap,
      used,
      remaining: Math.max(0, gosomCap - used),
    };
  }

  const cap = settings.monthlyRequestCap;
  const key = settings.googleApiKey ?? env.GOOGLE_PLACES_API_KEY ?? null;
  if (!key) {
    throw new ProspectError(
      'Nenhum motor de busca configurado. Defina PROSPECT_GOSOM_URL (motor gratuito) ou a chave da Places API em Configurações da prospecção.'
    );
  }
  const used = await loadUsage(db, accountId, 'google');
  return {
    provider: createGoogleProvider(key),
    keySource: settings.googleApiKey ? 'account' : 'server',
    cap,
    used,
    remaining: Math.max(0, cap - used),
  };
}
