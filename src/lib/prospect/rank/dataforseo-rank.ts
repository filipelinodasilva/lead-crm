import { ProviderError } from '../types';
import type { RankHit, RankProvider, RankQuery } from './provider';

// Position of a business for one point through DataForSEO "Google Maps SERP, Live".
// One task per call, the position comes from the real Maps results at that
// coordinate. depth 20 keeps it to the first page, like the Places provider.
// https://docs.dataforseo.com/v3/serp/google/maps/live/advanced/

const ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced';
const OK = 20000;

interface Item {
  type?: string;
  rank_group?: number;
  place_id?: string;
  title?: string;
}

/** DataForSEO wants the zoom in the coordinate: roughly 1 km between points is 15z. */
function zoomFor(spacingM: number): number {
  if (spacingM <= 500) return 16;
  if (spacingM <= 1000) return 15;
  if (spacingM <= 2000) return 14;
  if (spacingM <= 3000) return 13;
  return 12;
}

export function createDataForSeoRankProvider(
  login: string,
  password: string,
  fetchImpl: typeof fetch = fetch
): RankProvider {
  const auth = `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
  return {
    id: 'dataforseo',
    async rankAt(q: RankQuery): Promise<RankHit> {
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify([
            {
              keyword: q.keyword,
              location_coordinate: `${q.lat.toFixed(7)},${q.lng.toFixed(7)},${zoomFor(q.radiusM)}z`,
              language_code: 'pt',
              device: 'mobile',
              depth: 20,
            },
          ]),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new ProviderError('Could not reach DataForSEO.');
      }
      if (res.status === 401) {
        throw new ProviderError(
          'DataForSEO recusou o login ou a senha da API.',
          400
        );
      }
      const body = (await res.json().catch(() => null)) as {
        status_code?: number;
        status_message?: string;
        tasks?: {
          status_code?: number;
          status_message?: string;
          result?: { items?: Item[] }[] | null;
        }[];
      } | null;
      const task = body?.tasks?.[0];
      // the API sometimes answers 20000 with an empty task list and no charge:
      // that is not "business absent", so let the engine retry the point
      if (res.ok && body?.status_code === OK && !task) {
        throw new ProviderError('DataForSEO devolveu uma resposta vazia.', 502);
      }
      // 40xxx = bad credentials or request, 402 = no balance: retrying will not help
      const code = task?.status_code ?? body?.status_code;
      if (!res.ok || code !== OK) {
        const message =
          task?.status_message ??
          body?.status_message ??
          `DataForSEO answered ${res.status}.`;
        const fatal =
          res.status === 402 ||
          (typeof code === 'number' && code >= 40000 && code < 50000);
        throw new ProviderError(message, fatal ? 400 : 502);
      }
      const items = (task?.result?.[0]?.items ?? []).filter(
        (i) => i.type === 'maps_search' && i.place_id
      );
      const index = items.findIndex((i) => i.place_id === q.target.placeId);
      return {
        rank: index >= 0 ? (items[index].rank_group ?? index + 1) : null,
        top: items
          .slice(0, 3)
          .map((i) => ({ id: i.place_id as string, name: i.title })),
        requests: 1,
      };
    },
  };
}
