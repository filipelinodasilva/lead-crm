import { describe, expect, it } from 'vitest';

import { createDataForSeoRankProvider } from './dataforseo-rank';
import { createGoogleRankProvider } from './google-rank';
import { buildGrid, distanceM } from './grid';
import {
  compareWithPrevious,
  rankTone,
  summarize,
  topCompetitors,
  type PointResult,
} from './metrics';
import { createMockRankProvider } from './mock-rank';
import { parseScanInput } from './service';

const ID = '11111111-1111-4111-8111-111111111111';

describe('buildGrid', () => {
  it('makes size x size points, north row first, centered on the target', () => {
    const g = buildGrid(-19.92, -43.94, 5, 1000);
    expect(g).toHaveLength(25);
    expect(g[0]).toMatchObject({ row: 0, col: 0 });
    expect(g[0].lat).toBeGreaterThan(g[24].lat);
    expect(g[0].lng).toBeLessThan(g[24].lng);
    expect(g[12].lat).toBeCloseTo(-19.92, 5);
    expect(g[12].lng).toBeCloseTo(-43.94, 5);
  });
  it('spaces neighbours by the requested distance', () => {
    const g = buildGrid(-19.92, -43.94, 3, 1000);
    expect(distanceM(g[0].lat, g[0].lng, g[1].lat, g[1].lng)).toBeCloseTo(
      1000,
      -1
    );
    expect(distanceM(g[0].lat, g[0].lng, g[3].lat, g[3].lng)).toBeCloseTo(
      1000,
      -1
    );
  });
});

const pt = (
  rank: number | null,
  top: { id: string; name?: string }[] = [],
  status: PointResult['status'] = 'done'
): PointResult => ({
  row_idx: 0,
  col_idx: 0,
  lat: 0,
  lng: 0,
  status,
  rank,
  top,
});

describe('metrics', () => {
  it('summarizes only the points that finished', () => {
    const s = summarize([
      pt(1),
      pt(5),
      pt(null),
      pt(2),
      pt(null, [], 'queued'),
    ]);
    expect(s).toMatchObject({
      total: 5,
      done: 4,
      found: 3,
      top3: 2,
      foundShare: 75,
      top3Share: 50,
      avgRank: 2.7,
    });
    expect(summarize([]).avgRank).toBeNull();
  });
  it('colors by position', () => {
    expect([1, 3, 4, 10, 11, null].map(rankTone)).toEqual([
      'top',
      'top',
      'good',
      'good',
      'low',
      'none',
    ]);
  });
  it('lists who beats the target most often, without the target', () => {
    const c = topCompetitors(
      [
        pt(4, [{ id: 'a', name: 'A' }, { id: 'me' }, { id: 'b' }]),
        pt(5, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
        pt(null, [{ id: 'a' }]),
      ],
      'me'
    );
    expect(c.map((x) => [x.id, x.appearances])).toEqual([
      ['a', 3],
      ['b', 2],
      ['c', 1],
    ]);
    expect(c[0].name).toBe('A');
  });
  it('compares with the previous scan: positive is better', () => {
    const now = summarize([pt(1), pt(2), pt(3), pt(4)]);
    expect(
      compareWithPrevious({ avg_rank: 4, top3_count: 1, points_done: 4 }, now)
    ).toEqual({
      avgRankDelta: 1.5,
      top3ShareDelta: 50,
    });
    expect(compareWithPrevious(null, now)).toBeNull();
  });
});

describe('mock rank provider', () => {
  const target = { placeId: 'me', name: 'Eu', lat: -19.92, lng: -43.94 };
  const grid = buildGrid(target.lat, target.lng, 5, 1000);
  it('is deterministic and ranks better near the business than far away', async () => {
    const p = createMockRankProvider();
    const ask = (g: (typeof grid)[number]) =>
      p.rankAt({
        keyword: 'dentista',
        lat: g.lat,
        lng: g.lng,
        radiusM: 1000,
        target,
      });
    const center = await ask(grid[12]);
    expect(center).toEqual(await ask(grid[12]));
    expect(center.rank).not.toBeNull();
    expect(center.rank as number).toBeLessThanOrEqual(3);
    const corner = await ask(grid[0]);
    expect(corner.rank === null || corner.rank > (center.rank as number)).toBe(
      true
    );
    expect(center.requests).toBe(0);
  });
});

describe('google rank provider', () => {
  const target = { placeId: 'B', name: 'Eu', lat: 0, lng: 0 };
  const reply = (body: unknown, status = 200) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
      })) as unknown as typeof fetch;

  it('finds the position by place id and keeps the first three', async () => {
    const p = createGoogleRankProvider(
      'k'.repeat(30),
      { names: true },
      reply({
        places: [
          { id: 'A', displayName: { text: 'Aa' } },
          { id: 'B' },
          { id: 'C' },
          { id: 'D' },
        ],
      })
    );
    const hit = await p.rankAt({
      keyword: 'x',
      lat: 1,
      lng: 2,
      radiusM: 500,
      target,
    });
    expect(hit.rank).toBe(2);
    expect(hit.top.map((t) => t.id)).toEqual(['A', 'B', 'C']);
    expect(hit.requests).toBe(1);
  });
  it('returns null when absent and sends the cheapest field mask without names', async () => {
    let mask = '';
    const f = (async (_u: string, init: RequestInit) => {
      mask = (init.headers as Record<string, string>)['X-Goog-FieldMask'];
      return new Response(JSON.stringify({ places: [{ id: 'A' }] }));
    }) as unknown as typeof fetch;
    const p = createGoogleRankProvider('k'.repeat(30), { names: false }, f);
    expect(
      (await p.rankAt({ keyword: 'x', lat: 1, lng: 2, radiusM: 500, target }))
        .rank
    ).toBeNull();
    expect(mask).toBe('places.id');
  });
  it('turns a rejected key into a provider error with the Google message', async () => {
    const p = createGoogleRankProvider(
      'k'.repeat(30),
      { names: true },
      reply({ error: { message: 'API key not valid' } }, 403)
    );
    await expect(
      p.rankAt({ keyword: 'x', lat: 1, lng: 2, radiusM: 500, target })
    ).rejects.toThrow(/API key not valid/);
  });
});

describe('parseScanInput', () => {
  it('applies defaults and rejects bad values', () => {
    expect(parseScanInput({ leadId: ID, keyword: ' dentista ' })).toEqual({
      leadId: ID,
      keyword: 'dentista',
      gridSize: 5,
      spacingM: 1000,
    });
    expect(() => parseScanInput({ leadId: 'x', keyword: 'dentista' })).toThrow(
      /empresa/
    );
    expect(() => parseScanInput({ leadId: ID, keyword: 'a' })).toThrow(
      /palavra-chave/
    );
    expect(() =>
      parseScanInput({ leadId: ID, keyword: 'dentista', gridSize: 4 })
    ).toThrow(/grade/);
    expect(() =>
      parseScanInput({ leadId: ID, keyword: 'dentista', spacingM: 7 })
    ).toThrow(/Distância/);
  });
});

describe('dataforseo rank provider', () => {
  const target = { placeId: 'B', name: 'Eu', lat: 0, lng: 0 };
  const task = (items: unknown[], status_code = 20000) => ({
    status_code: 20000,
    tasks: [
      {
        status_code,
        status_message: status_code === 20000 ? 'Ok.' : 'Payment Required.',
        result: [{ items }],
      },
    ],
  });
  const reply = (body: unknown, status = 200) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
      })) as unknown as typeof fetch;
  const ask = (f: typeof fetch) =>
    createDataForSeoRankProvider('login', 'pass', f).rankAt({
      keyword: 'x',
      lat: -19.92,
      lng: -43.94,
      radiusM: 1000,
      target,
    });

  it('sends basic auth and a coordinate with zoom, then finds the position', async () => {
    let seen: { auth: string; body: Record<string, unknown> } | null = null;
    const f = (async (_u: string, init: RequestInit) => {
      seen = {
        auth: (init.headers as Record<string, string>).Authorization,
        body: JSON.parse(init.body as string)[0],
      };
      return new Response(
        JSON.stringify(
          task([
            { type: 'maps_paid_item', place_id: 'ad' },
            { type: 'maps_search', rank_group: 1, place_id: 'A', title: 'Aa' },
            { type: 'maps_search', rank_group: 2, place_id: 'B', title: 'Eu' },
          ])
        )
      );
    }) as unknown as typeof fetch;
    const hit = await ask(f);
    expect(hit).toMatchObject({ rank: 2, requests: 1 });
    expect(hit.top.map((t) => t.id)).toEqual(['A', 'B']);
    expect(seen!.auth).toBe(
      `Basic ${Buffer.from('login:pass').toString('base64')}`
    );
    expect(seen!.body.location_coordinate).toBe('-19.9200000,-43.9400000,15z');
  });
  it('returns null when the business is not in the results', async () => {
    expect(
      (
        await ask(
          reply(task([{ type: 'maps_search', rank_group: 1, place_id: 'A' }]))
        )
      ).rank
    ).toBeNull();
  });
  it('does not read an empty task list as "not found"', async () => {
    await expect(
      ask(reply({ status_code: 20000, tasks: [] }))
    ).rejects.toMatchObject({ status: 502 });
  });
  it('treats bad credentials and no balance as fatal, other errors as retryable', async () => {
    await expect(ask(reply({}, 401))).rejects.toMatchObject({ status: 400 });
    await expect(ask(reply(task([], 40200)))).rejects.toMatchObject({
      status: 400,
      message: 'Payment Required.',
    });
    await expect(ask(reply(task([], 50000)))).rejects.toMatchObject({
      status: 502,
    });
  });
});
