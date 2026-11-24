// Integration test for "add lead to the funnel" against a LOCAL Supabase.
// Skipped unless PROSPECT_INTEGRATION=1 (it needs the local stack and .env.local):
//   PROSPECT_INTEGRATION=1 npx vitest run src/lib/prospect/pipeline.int.test.ts
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sendLeadsToPipeline, type ProspectContext } from './service';

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

describe.skipIf(!run)('send leads to the funnel (local Supabase)', () => {
  let db: SupabaseClient;
  let ctx: ProspectContext;
  let userId = '';
  let accountId = '';
  let pipelineId = '';
  let stageA = '';
  let stageB = '';
  let leadWithPhone = '';
  let leadNoPhone = '';

  async function makeLead(name: string, phone: string | null) {
    const { data } = await db
      .from('prospect_leads')
      .insert({
        account_id: accountId,
        provider: 'gosom',
        place_id: `int-${randomBytes(6).toString('hex')}`,
        name,
        phone,
        phone_e164: phone,
        phone_kind: phone ? 'mobile' : 'unknown',
        review_count: 10,
      })
      .select('id')
      .single();
    return data!.id as string;
  }

  async function openDeals() {
    const { data } = await db
      .from('deals')
      .select('stage_id')
      .eq('account_id', accountId)
      .eq('pipeline_id', pipelineId)
      .eq('status', 'open');
    return (data ?? []) as { stage_id: string }[];
  }

  beforeAll(async () => {
    const env = loadEnv();
    db = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data: user } = await db.auth.admin.createUser({
      email: `cp-pipe-${randomBytes(4).toString('hex')}@example.com`,
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
    const { data: pipeline } = await db
      .from('pipelines')
      .insert({ account_id: accountId, user_id: userId, name: 'int' })
      .select('id')
      .single();
    pipelineId = pipeline!.id;
    const { data: a } = await db
      .from('pipeline_stages')
      .insert({ pipeline_id: pipelineId, name: 'Novo', position: 0 })
      .select('id')
      .single();
    stageA = a!.id;
    const { data: b } = await db
      .from('pipeline_stages')
      .insert({ pipeline_id: pipelineId, name: 'Contatado', position: 1 })
      .select('id')
      .single();
    stageB = b!.id;
    leadWithPhone = await makeLead('Clínica Teste', '+5531999990001');
    leadNoPhone = await makeLead('Sem Telefone', null);
    ctx = { supabase: db, accountId, userId };
  });

  afterAll(async () => {
    if (!run) return;
    await db.from('accounts').delete().eq('id', accountId);
    await db.auth.admin.deleteUser(userId);
  });

  it('adds a lead to the chosen stage and marks it as in the funnel', async () => {
    const r = await sendLeadsToPipeline(ctx, {
      ids: [leadWithPhone],
      pipelineId,
      stageId: stageA,
    });
    expect(r.added).toBe(1);
    expect(r.moved).toBe(0);
    expect(await openDeals()).toEqual([{ stage_id: stageA }]);
    const { data } = await db
      .from('prospect_leads')
      .select('status, contact_id')
      .eq('id', leadWithPhone)
      .single();
    expect(data?.status).toBe('in_pipeline');
    expect(data?.contact_id).toBeTruthy();
  });

  it('does not duplicate or move it on a bulk send', async () => {
    const r = await sendLeadsToPipeline(ctx, {
      ids: [leadWithPhone],
      pipelineId,
      stageId: stageB,
    });
    expect(r.added).toBe(0);
    expect(r.alreadyInPipeline).toBe(1);
    expect(r.moved).toBe(0);
    expect(await openDeals()).toEqual([{ stage_id: stageA }]);
  });

  it('moves it to another stage when asked, still a single deal', async () => {
    const r = await sendLeadsToPipeline(ctx, {
      ids: [leadWithPhone],
      pipelineId,
      stageId: stageB,
      moveExisting: true,
    });
    expect(r.moved).toBe(1);
    expect(r.added).toBe(0);
    expect(r.alreadyInPipeline).toBe(0);
    expect(await openDeals()).toEqual([{ stage_id: stageB }]);
  });

  it('skips a lead with no phone and creates nothing for it', async () => {
    const r = await sendLeadsToPipeline(ctx, {
      ids: [leadNoPhone],
      pipelineId,
      stageId: stageA,
      moveExisting: true,
    });
    expect(r.skippedNoPhone).toBe(1);
    expect(r.added).toBe(0);
    expect(r.moved).toBe(0);
    expect(await openDeals()).toHaveLength(1);
  });

  it('rejects a stage that is not in the pipeline', async () => {
    await expect(
      sendLeadsToPipeline(ctx, {
        ids: [leadWithPhone],
        pipelineId,
        stageId: '00000000-0000-4000-8000-000000000000',
      })
    ).rejects.toThrow(/não encontrada/);
  });
});
