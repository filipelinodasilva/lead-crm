// Integration test for the sending engine against a LOCAL Supabase.
// Skipped unless PROSPECT_INTEGRATION=1 (it needs the local stack and .env.local):
//   PROSPECT_INTEGRATION=1 npx vitest run src/lib/prospect/campaign/engine.int.test.ts
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { tickCampaign } from './engine';
import type { Sender } from './sender';

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

describe.skipIf(!run)('campaign engine (local Supabase)', () => {
  let db: SupabaseClient;
  let userId = '';
  let accountId = '';
  let pipelineId = '';
  let stageId = '';
  const monday9am = () => new Date('2026-10-26T13:00:00Z'); // Monday 10:00 in Sao Paulo

  const ok: Sender = async () => ({ conversationId: null });
  const boom: Sender = async () => {
    throw new Error('WhatsApp recusou');
  };
  const connected = async () => 'ok' as const;

  async function makeCampaign(
    over: Record<string, unknown> = {},
    recipients = 5
  ) {
    const { data: c } = await db
      .from('prospect_campaigns')
      .insert({
        account_id: accountId,
        created_by: userId,
        name: 'int-test',
        status: 'running',
        pipeline_id: pipelineId,
        stage_id: stageId,
        kind: 'text',
        message_text: 'Oi {nome}',
        daily_limit: 100,
        warmup: false,
        min_interval_s: 10,
        max_interval_s: 10,
        started_at: new Date('2026-10-01T12:00:00Z').toISOString(),
        ...over,
      })
      .select('*')
      .single();
    for (let i = 0; i < recipients; i++) {
      const phone = `5500${Math.floor(10000000 + Math.random() * 89999999)}`;
      const { data: contact } = await db
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: userId,
          phone,
          name: `Lead ${i}`,
        })
        .select('id')
        .single();
      await db
        .from('prospect_campaign_recipients')
        .insert({
          campaign_id: c!.id,
          account_id: accountId,
          contact_id: contact!.id,
        });
    }
    return c!.id as string;
  }

  beforeAll(async () => {
    const env = loadEnv();
    db = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );
    const email = `cp-int-${randomBytes(4).toString('hex')}@example.com`;
    const { data: user } = await db.auth.admin.createUser({
      email,
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
    const { data: stage } = await db
      .from('pipeline_stages')
      .insert({ pipeline_id: pipelineId, name: 'Novo', position: 0 })
      .select('id')
      .single();
    stageId = stage!.id;
  });

  afterAll(async () => {
    if (!run) return;
    await db.from('accounts').delete().eq('id', accountId);
    await db.auth.admin.deleteUser(userId);
  });

  it('sends one message per tick and respects the gap between sends', async () => {
    const id = await makeCampaign();
    const first = await tickCampaign(id, {
      db,
      send: ok,
      check: connected,
      now: monday9am,
    });
    expect(first.outcome).toBe('sent');
    const second = await tickCampaign(id, {
      db,
      send: ok,
      check: connected,
      now: monday9am,
    });
    expect(second.outcome).toBe('waiting');
    const later = () => new Date(monday9am().getTime() + 11_000);
    expect(
      (await tickCampaign(id, { db, send: ok, check: connected, now: later }))
        .outcome
    ).toBe('sent');
  });

  it('does not send outside the window or on a day that is not selected', async () => {
    const id = await makeCampaign();
    const night = () => new Date('2026-10-26T03:00:00Z'); // Sunday 00:00 local
    expect(
      (await tickCampaign(id, { db, send: ok, check: connected, now: night }))
        .outcome
    ).toBe('outside_window');
    const saturday = () => new Date('2026-10-31T15:00:00Z');
    expect(
      (
        await tickCampaign(id, {
          db,
          send: ok,
          check: connected,
          now: saturday,
        })
      ).outcome
    ).toBe('outside_window');
  });

  it('only one of two overlapping scheduler calls sends', async () => {
    const id = await makeCampaign();
    const [a, b] = await Promise.all([
      tickCampaign(id, { db, send: ok, check: connected, now: monday9am }),
      tickCampaign(id, { db, send: ok, check: connected, now: monday9am }),
    ]);
    expect([a.outcome, b.outcome].filter((o) => o === 'sent')).toHaveLength(1);
    const { count } = await db
      .from('prospect_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .not('first_sent_at', 'is', null);
    expect(count).toBe(1);
  });

  it('pauses the campaign after three failures in a row and keeps the error text', async () => {
    const id = await makeCampaign();
    let t = monday9am().getTime();
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) {
      t += 200_000;
      outcomes.push(
        (
          await tickCampaign(id, {
            db,
            send: boom,
            check: connected,
            now: () => new Date(t),
          })
        ).outcome
      );
    }
    expect(outcomes.slice(0, 3)).toEqual(['failed', 'failed', 'failed']);
    expect(outcomes[3]).toBe('inactive');
    const { data: c } = await db
      .from('prospect_campaigns')
      .select('status, paused_reason')
      .eq('id', id)
      .single();
    expect(c).toMatchObject({ status: 'paused', paused_reason: 'errors' });
    const { data: rows } = await db
      .from('prospect_campaign_recipients')
      .select('error, attempts')
      .eq('campaign_id', id)
      .not('error', 'is', null);
    expect(rows).toHaveLength(3);
    expect(rows![0].error).toBe('WhatsApp recusou');
  });

  it('pauses when the WhatsApp connection is down and sends nothing', async () => {
    const id = await makeCampaign();
    let sends = 0;
    const counting: Sender = async () => {
      sends += 1;
      return { conversationId: null };
    };
    const out = await tickCampaign(id, {
      db,
      send: counting,
      check: async () => 'disconnected',
      now: monday9am,
    });
    expect(out.outcome).toBe('paused');
    expect(sends).toBe(0);
    const { data: c } = await db
      .from('prospect_campaigns')
      .select('status, paused_reason')
      .eq('id', id)
      .single();
    expect(c).toMatchObject({
      status: 'paused',
      paused_reason: 'disconnected',
    });
  });

  it('never messages a number that opted out', async () => {
    const id = await makeCampaign({}, 1);
    const { data: rec } = await db
      .from('prospect_campaign_recipients')
      .select('contact_id')
      .eq('campaign_id', id)
      .single();
    const { data: contact } = await db
      .from('contacts')
      .select('phone')
      .eq('id', rec!.contact_id)
      .single();
    await db
      .from('prospect_optouts')
      .insert({
        account_id: accountId,
        phone_normalized: contact!.phone.replace(/\D/g, ''),
      });
    let sends = 0;
    const counting: Sender = async () => {
      sends += 1;
      return { conversationId: null };
    };
    const out = await tickCampaign(id, {
      db,
      send: counting,
      check: connected,
      now: monday9am,
    });
    expect(out.outcome).toBe('idle');
    expect(sends).toBe(0);
    const { data: after } = await db
      .from('prospect_campaign_recipients')
      .select('status')
      .eq('campaign_id', id)
      .single();
    expect(after!.status).toBe('opted_out');
  });
});
