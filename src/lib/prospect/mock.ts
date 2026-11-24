import { parsePlacePhone } from './phone';
import type {
  PlaceResult,
  PlacesProvider,
  SearchOutcome,
  SearchParams,
} from './types';

// Test provider: invented businesses, no API key, no cost. It is what the
// module uses until the account adds a Google key, so the whole flow
// (filters, selection, pipeline, webhook, CSV) can be tried first.
//
// Safety: every phone uses area code "00", which does not exist in Brazil,
// so a test lead pushed to a pipeline can never reach a real person.

const PREFIXES = [
  'Clínica',
  'Espaço',
  'Studio',
  'Centro',
  'Casa',
  'Instituto',
  'Grupo',
  'Estúdio',
];
const NAMES = [
  'Bem Estar',
  'Vida Plena',
  'Prime',
  'Essência',
  'Nova Era',
  'Aurora',
  'Equilíbrio',
  'Horizonte',
  'Cuidar',
  'Excelência',
];
const STREETS = [
  'Rua das Flores',
  'Av. Brasil',
  'Rua Minas Gerais',
  'Av. Central',
  'Rua do Comércio',
  'Rua da Paz',
];
const DISTRICTS = [
  'Centro',
  'Savassi',
  'Funcionários',
  'Santa Efigênia',
  'Pampulha',
  'Buritis',
  'Cidade Nova',
];

/** Small deterministic PRNG so the same search always returns the same businesses. */
function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const pick = <T>(list: T[], r: () => number): T =>
  list[Math.floor(r() * list.length)];
const digits = (n: number, r: () => number) =>
  Array.from({ length: n }, () => Math.floor(r() * 10)).join('');

export function generateMockPlaces(params: SearchParams): PlaceResult[] {
  const key = `${params.query.trim().toLowerCase()}|${params.location.trim().toLowerCase()}`;
  const r = seeded(key);
  const [cityRaw, stateRaw] = params.location.split(',').map((s) => s.trim());
  const city = cityRaw || params.location.trim();
  const state = (stateRaw || 'MG').toUpperCase().slice(0, 2);
  const count = Math.max(1, Math.min(params.maxResults, 60));
  const seen = new Set<string>();
  const places: PlaceResult[] = [];

  while (places.length < count) {
    const name = `${pick(PREFIXES, r)} ${pick(NAMES, r)} ${params.query.trim()} (teste)`;
    const district = pick(DISTRICTS, r);
    const id = `mock_${key.replace(/[^a-z0-9]+/g, '-')}_${places.length}_${name.length}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const mobile = r() < 0.7;
    const intl = mobile
      ? `+55 00 9${digits(4, r)}-${digits(4, r)}`
      : `+55 00 ${2 + Math.floor(r() * 4)}${digits(3, r)}-${digits(4, r)}`;
    const phone = parsePlacePhone(intl);
    const hasSite = r() < 0.55;
    places.push({
      placeId: id,
      name,
      category: params.query.trim().toLowerCase().replace(/\s+/g, '_'),
      address: `${pick(STREETS, r)}, ${100 + Math.floor(r() * 900)} - ${district}, ${city} - ${state}`,
      city,
      state,
      lat: -19.9 + r() * 0.1,
      lng: -43.9 + r() * 0.1,
      phone: intl.replace('+55 00 ', '(00) '),
      phoneE164: phone.e164,
      phoneKind: phone.kind,
      website: hasSite
        ? `https://exemplo-${places.length}.example.com.br`
        : null,
      rating: Math.round((3.4 + r() * 1.6) * 10) / 10,
      reviewCount: Math.floor(r() * r() * 400),
      businessStatus: 'OPERATIONAL',
      mapsUrl: null,
    });
  }
  return places;
}

export function createMockProvider(): PlacesProvider {
  return {
    id: 'mock',
    async search(params: SearchParams): Promise<SearchOutcome> {
      return { places: generateMockPlaces(params), requests: 0 };
    },
  };
}
