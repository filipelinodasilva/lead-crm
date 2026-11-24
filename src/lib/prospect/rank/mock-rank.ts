import { distanceM } from './grid';
import type { RankHit, RankProvider, RankQuery } from './provider';

// Test provider: a believable ranking with no API key and no cost. The business
// ranks well next to its own address and worse the farther the point is, up to
// not appearing at all, with a little noise so the map is not a perfect circle.

const COMPETITORS = [
  'Clínica Prime',
  'Espaço Vida',
  'Centro Bem Estar',
  'Studio Aurora',
  'Instituto Horizonte',
  'Casa Equilíbrio',
  'Grupo Excelência',
  'Clínica Nova Era',
];

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

export function createMockRankProvider(): RankProvider {
  return {
    id: 'mock',
    async rankAt(q: RankQuery): Promise<RankHit> {
      const r = seeded(
        `${q.keyword.toLowerCase()}|${q.lat.toFixed(5)}|${q.lng.toFixed(5)}`
      );
      // distance in "radius units": 1 = the spacing the scan was drawn with
      const d =
        distanceM(q.lat, q.lng, q.target.lat, q.target.lng) /
        Math.max(1, q.radiusM / 0.75);
      const noise = (r() - 0.5) * 2.2;
      const score = d * 7 + noise;
      const rank = score > 17 ? null : Math.max(1, Math.round(1 + score));

      const names = [...COMPETITORS].sort(() => r() - 0.5);
      const rivals = names.slice(0, 3).map((name, i) => ({
        id: `mock_rival_${COMPETITORS.indexOf(name)}`,
        name,
      }));
      const top =
        rank !== null && rank <= 3
          ? [
              ...rivals.slice(0, rank - 1),
              { id: q.target.placeId, name: q.target.name },
              ...rivals,
            ].slice(0, 3)
          : rivals;
      return { rank, top, requests: 0 };
    },
  };
}
