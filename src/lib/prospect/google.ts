import { parsePlacePhone } from './phone';
import {
  ProviderError,
  type PlaceResult,
  type PlacesProvider,
  type SearchOutcome,
  type SearchParams,
} from './types';

// Google Places API (New) — Text Search.
// https://developers.google.com/maps/documentation/places/web-service/text-search
//
// Phone, website, rating and review count are Enterprise-tier fields, so
// each page is billed at the Enterprise rate (1,000 free requests/month).
// A page holds up to 20 places and there are at most 3 pages per query.

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const PAGE_SIZE = 20;
const MAX_PAGES = 3;

export const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.primaryType',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.googleMapsUri',
  'nextPageToken',
].join(',');

interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  primaryType?: string;
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  googleMapsUri?: string;
}

function component(
  list: GoogleAddressComponent[] | undefined,
  type: string
): GoogleAddressComponent | undefined {
  return list?.find((c) => c.types?.includes(type));
}

/** Map one Google place to the shape the app stores. Returns null if it has no id or name. */
export function normalizeGooglePlace(p: GooglePlace): PlaceResult | null {
  const name = p.displayName?.text?.trim();
  if (!p.id || !name) return null;
  const city =
    component(p.addressComponents, 'locality') ??
    component(p.addressComponents, 'administrative_area_level_2');
  const state = component(p.addressComponents, 'administrative_area_level_1');
  const phone = parsePlacePhone(p.internationalPhoneNumber);
  return {
    placeId: p.id,
    name,
    category: p.primaryType ?? null,
    address: p.formattedAddress ?? null,
    city: city?.longText ?? null,
    state: state?.shortText ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
    phoneE164: phone.e164,
    phoneKind: phone.kind,
    website: p.websiteUri ?? null,
    rating: typeof p.rating === 'number' ? p.rating : null,
    reviewCount: p.userRatingCount ?? 0,
    businessStatus: p.businessStatus ?? null,
    mapsUrl: p.googleMapsUri ?? null,
  };
}

export function createGoogleProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): PlacesProvider {
  return {
    id: 'google',
    async search(
      params: SearchParams,
      requestBudget: number
    ): Promise<SearchOutcome> {
      const places: PlaceResult[] = [];
      const wanted = Math.max(
        1,
        Math.min(params.maxResults, PAGE_SIZE * MAX_PAGES)
      );
      const textQuery = `${params.query} em ${params.location}`;
      let pageToken: string | undefined;
      let requests = 0;

      while (
        places.length < wanted &&
        requests < MAX_PAGES &&
        requests < requestBudget
      ) {
        let res: Response;
        try {
          res = await fetchImpl(ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
            },
            body: JSON.stringify({
              textQuery,
              languageCode: 'pt-BR',
              regionCode: 'BR',
              pageSize: PAGE_SIZE,
              ...(pageToken ? { pageToken } : {}),
            }),
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          if (places.length > 0) {
            return {
              places,
              requests,
              warning: 'Google did not answer for the next page.',
            };
          }
          throw new ProviderError('Could not reach the Google Places API.');
        }

        if (!res.ok) {
          const detail = await res
            .json()
            .then((j: { error?: { message?: string } }) => j?.error?.message)
            .catch(() => undefined);
          const message = detail ?? `Google Places API answered ${res.status}.`;
          if (places.length > 0) return { places, requests, warning: message };
          throw new ProviderError(
            message,
            res.status === 400 || res.status === 403 ? 400 : 502
          );
        }

        requests += 1;
        const data = (await res.json()) as {
          places?: GooglePlace[];
          nextPageToken?: string;
        };
        for (const raw of data.places ?? []) {
          const place = normalizeGooglePlace(raw);
          if (place) places.push(place);
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }

      return { places: places.slice(0, wanted), requests };
    },
  };
}
