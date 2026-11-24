import type { SupabaseClient } from '@supabase/supabase-js';

import { loadSettings, loadUsage } from '../settings';
import { createDataForSeoRankProvider } from './dataforseo-rank';
import { createGoogleRankProvider } from './google-rank';
import { ProspectError } from '../types';
import { createMockRankProvider } from './mock-rank';
import type { RankProvider } from './provider';

/** Own monthly counter per paid provider (google_rank, dataforseo_rank). */
export const rankUsageKey = (id: RankProvider['id']) => `${id}_rank`;

export interface ResolvedRank {
  provider: RankProvider;
  cap: number;
  used: number;
  /** Requests left this month; unlimited with the test provider. */
  remaining: number;
}

/**
 * Account setting `rank_provider`: 'dataforseo' or 'google' force that one;
 * 'auto' prefers DataForSEO, then the Google key (account, else server). With
 * no credentials the scan fails with a clear message instead of inventing
 * positions. `PROSPECT_PROVIDER=mock` forces the test provider (automated tests only).
 */
export async function resolveRankProvider(
  db: SupabaseClient,
  accountId: string,
  env: Record<string, string | undefined> = process.env
): Promise<ResolvedRank> {
  const settings = await loadSettings(db, accountId);
  const forceMock = env.PROSPECT_PROVIDER === 'mock';
  const googleKey = settings.googleApiKey ?? env.GOOGLE_PLACES_API_KEY ?? null;
  const hasDfs = Boolean(
    settings.dataforseoLogin && settings.dataforseoPassword
  );
  const want = settings.rankProvider;
  const useDfs = !forceMock && hasDfs && want !== 'google';
  const useGoogle =
    !forceMock && !useDfs && Boolean(googleKey) && want !== 'dataforseo';

  let provider: RankProvider;
  if (forceMock) {
    provider = createMockRankProvider();
  } else if (useDfs) {
    provider = createDataForSeoRankProvider(
      settings.dataforseoLogin as string,
      settings.dataforseoPassword as string
    );
  } else if (useGoogle) {
    provider = createGoogleRankProvider(googleKey as string, {
      names: env.PROSPECT_RANK_NAMES !== '0',
    });
  } else {
    throw new ProspectError(
      'Nenhum provedor de ranking configurado. Informe a chave da Places API ou o login do DataForSEO em Configurações da prospecção.'
    );
  }
  if (provider.id === 'mock') {
    return {
      provider,
      cap: settings.rankRequestCap,
      used: 0,
      remaining: Number.MAX_SAFE_INTEGER,
    };
  }
  const used = await loadUsage(db, accountId, rankUsageKey(provider.id));
  return {
    provider,
    cap: settings.rankRequestCap,
    used,
    remaining: Math.max(0, settings.rankRequestCap - used),
  };
}
