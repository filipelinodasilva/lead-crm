import { ProviderError } from '../types';
import type { RankHit, RankProvider, RankQuery } from './provider';

// Position of a business for one point: Places API (New) Text Search biased to
// that point, first page only (20 results). Fetching only `places.id` keeps the
// request in the cheapest tier; asking for names too (to show who is ahead)
// moves it to a paid tier, so it is a switch.
// https://developers.google.com/maps/documentation/places/web-service/text-search

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const MAX_BIAS_RADIUS_M = 50_000;

export function createGoogleRankProvider(
  apiKey: string,
  options: { names: boolean } = { names: true },
  fetchImpl: typeof fetch = fetch
): RankProvider {
  return {
    id: 'google',
    async rankAt(q: RankQuery): Promise<RankHit> {
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': options.names
              ? 'places.id,places.displayName'
              : 'places.id',
          },
          body: JSON.stringify({
            textQuery: q.keyword,
            languageCode: 'pt-BR',
            regionCode: 'BR',
            pageSize: 20,
            locationBias: {
              circle: {
                center: { latitude: q.lat, longitude: q.lng },
                radius: Math.min(MAX_BIAS_RADIUS_M, Math.max(100, q.radiusM)),
              },
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new ProviderError('Could not reach the Google Places API.');
      }
      if (!res.ok) {
        const detail = await res
          .json()
          .then((j: { error?: { message?: string } }) => j?.error?.message)
          .catch(() => undefined);
        throw new ProviderError(
          detail ?? `Google Places API answered ${res.status}.`,
          res.status === 400 || res.status === 403 ? 400 : 502
        );
      }
      const data = (await res.json()) as {
        places?: { id?: string; displayName?: { text?: string } }[];
      };
      const places = (data.places ?? []).filter((p) => p.id);
      const index = places.findIndex((p) => p.id === q.target.placeId);
      return {
        rank: index >= 0 ? index + 1 : null,
        top: places
          .slice(0, 3)
          .map((p) => ({ id: p.id as string, name: p.displayName?.text })),
        requests: 1,
      };
    },
  };
}
