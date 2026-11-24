// Integration test for the ranking engine against a LOCAL Supabase.
// Skipped unless PROSPECT_INTEGRATION=1:
//   PROSPECT_INTEGRATION=1 npx vitest run src/lib/prospect/rank/engine.int.test.ts
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProviderError } from '../types';
import { processScan } from './engine';
import { buildGrid } from './grid';
import type { RankProvider } from './provider';
import { createMockRankProvider } from './mock-rank';

const run = process.env.PROSPECT_INTEGRATION === '1';

function loadEnv(): Record<string, string> {
  const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
}

describe.skipIf(!run)('ranking engine (local Supabase)', () => {
  let db: SupabaseClient;
  let userId = '';
  let accountId = '';

  async function makeScan(size = 3) {
    const lat = -19.92;
    const lng = -43.94;
    const { data: scan } = await db
      .from('prospect_rank_scans')
      .insert({
        account_id: accountId,
        created_by: userId,
        target_place_id: 'mock_target',
        target_name: 'Alvo (teste)',
        target_lat: lat,
        target_lng: lng,
        keyword: 'dentista',
        center_lat: lat,
        center_lng: lng,
        grid_size: size,
        spacing_m: 1000,
        provider: 'mock',
        points_total: size * size,
      })
      .select('id')
      .single();
    await db.from('prospect_rank_points').insert(
      buildGrid(lat, lng, size, 1000).map((p) => ({
        scan_id: scan!.id,
        account_id: accountId,
        row_idx: p.row,
        col_idx: p.col,
        lat: p.lat,
        lng: p.lng,
      }))
    );
    return scan!.id as string;
  }

  const scanRow = async (id: string) =>
    (await db.from('prospect_rank_scans').select('*').eq('id', id).single())
      .data!;

  beforeAll(async () => {
    const env = loadEnv();
    db = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data: user } = await db.auth.admin.createUser({
      email: `cp-rank-${randomBytes(4).toString('hex')}@example.com`,
      password: randomBytes(12).toString('hex'),
      email_confirm: true,
    });
    userId = user.user!.id;
    const { data: profile } = await db
      .from('profiles')
      .select('account_id')
      .eq('user_id', userId)
      .single();
    accountId = profile!.account_id;
  });

  afterAll(async () => {
    if (!run) return;
    await db.from('accounts').delete().eq('id', accountId);
    await db.auth.admin.deleteUser(userId);
  });

  it('measures every point and stores the summary', async () => {
    const id = await makeScan(5);
    expect(
      await processScan(id, { db, provider: createMockRankProvider() })
    ).toBe(true);
    const s = await scanRow(id);
    expect(s).toMatchObject({ status: 'done', points_done: 25 });
    expect(s.found_count).toBeGreaterThan(0);
    expect(Number(s.avg_rank)).toBeGreaterThan(0);
  });

  it('can be finished in several calls and never measures a point twice', async () => {
    const id = await makeScan(5);
    let calls = 0;
    const counting: RankProvider = {
      id: 'mock',
      rankAt: (q) => {
        calls += 1;
        return createMockRankProvider().rankAt(q);
      },
    };
    expect(await processScan(id, { db, provider: counting }, 10)).toBe(false);
    expect((await scanRow(id)).status).toBe('running');
    await Promise.all([
      processScan(id, { db, provider: counting }, 30),
      processScan(id, { db, provider: counting }, 30),
    ]);
    expect(calls).toBe(25);
    expect((await scanRow(id)).status).toBe('done');
  });

  it('retries a point that fails and gives up after three tries', async () => {
    const id = await makeScan(3);
    let first = true;
    const flaky: RankProvider = {
      id: 'mock',
      rankAt: async (q) => {
        if (first) {
          first = false;
          throw new Error('timeout');
        }
        return createMockRankProvider().rankAt(q);
      },
    };
    await processScan(id, { db, provider: flaky });
    expect((await scanRow(id)).status).toBe('done');
    const { data: pts } = await db
      .from('prospect_rank_points')
      .select('status')
      .eq('scan_id', id);
    expect(pts!.every((p) => p.status === 'done')).toBe(true);

    const id2 = await makeScan(3);
    const broken: RankProvider = {
      id: 'mock',
      rankAt: async () => {
        throw new Error('x');
      },
    };
    await processScan(id2, { db, provider: broken });
    await processScan(id2, { db, provider: broken });
    await processScan(id2, { db, provider: broken });
    const s2 = await scanRow(id2);
    expect(s2).toMatchObject({ status: 'failed' });
    expect(s2.error).toMatch(/Nenhum ponto/);
  });

  it('fails the scan with the Google message when the key is rejected', async () => {
    const id = await makeScan(3);
    const rejected: RankProvider = {
      id: 'mock',
      rankAt: async () => {
        throw new ProviderError('API key not valid', 400);
      },
    };
    await processScan(id, { db, provider: rejected });
    expect(await scanRow(id)).toMatchObject({
      status: 'failed',
      error: 'API key not valid',
    });
  });
});
