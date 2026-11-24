import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isOptOutText,
  renderMessage,
  variablesFor,
  type VariableName,
} from './message';
import {
  effectiveDailyCap,
  isInWindow,
  localDayStart,
  nextDelayMs,
  type SendWindow,
} from './schedule';
import {
  checkConnection,
  defaultSender,
  type ConnectionCheck,
  type Sender,
} from './sender';
import type { Campaign, Recipient } from './types';

// The sending engine. `tickCampaign` sends at most ONE message per call; the
// scheduler calls it every minute, and the campaign's own `next_send_at`
// enforces the random gap between sends. Everything is filtered by account_id
// because the engine runs with the service role.

export interface EngineDeps {
  db: SupabaseClient;
  now?: () => Date;
  rng?: () => number;
  send?: Sender;
  check?: (
    db: SupabaseClient,
    campaign: Pick<Campaign, 'account_id' | 'connection_id'>
  ) => Promise<ConnectionCheck>;
}

export type TickOutcome =
  | 'sent'
  | 'failed'
  | 'idle'
  | 'waiting'
  | 'outside_window'
  | 'daily_cap'
  | 'paused'
  | 'inactive';

export interface TickResult {
  campaignId: string;
  outcome: TickOutcome;
  detail?: string;
}

const CHUNK = 100;
const CLAIM_MS = 10 * 60_000;
const ERRORS_BEFORE_PAUSE = 3;
const MAX_ATTEMPTS = 3;
const REPLY_LOOKBACK_MS = 14 * 86_400_000;

const digitsOf = (phone: string | null | undefined) =>
  (phone ?? '').replace(/\D/g, '');

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

export function windowOf(c: Campaign): SendWindow {
  return {
    startMin: c.window_start_min,
    endMin: c.window_end_min,
    days: c.days,
    timezone: c.timezone,
  };
}

// ---------- watcher: deals in the stage become recipients ----------

export async function enqueueStage(
  db: SupabaseClient,
  c: Pick<Campaign, 'id' | 'account_id' | 'pipeline_id' | 'stage_id'>
): Promise<{ queued: number; skipped: number }> {
  const { data: deals } = await db
    .from('deals')
    .select('id, contact_id')
    .eq('account_id', c.account_id)
    .eq('pipeline_id', c.pipeline_id)
    .eq('stage_id', c.stage_id)
    .eq('status', 'open')
    .limit(5000);
  if (!deals?.length) return { queued: 0, skipped: 0 };

  const known = new Set<string>();
  for (const part of chunked(deals.map((d) => d.contact_id as string))) {
    const { data } = await db
      .from('prospect_campaign_recipients')
      .select('contact_id')
      .eq('campaign_id', c.id)
      .in('contact_id', part);
    for (const row of data ?? []) known.add(row.contact_id as string);
  }
  const fresh = deals.filter((d) => !known.has(d.contact_id as string));
  if (fresh.length === 0) return { queued: 0, skipped: 0 };

  const contactIds = [...new Set(fresh.map((d) => d.contact_id as string))];
  const phoneOf = new Map<string, string>();
  const leadOf = new Map<string, string>();
  for (const part of chunked(contactIds)) {
    const { data: contacts } = await db
      .from('contacts')
      .select('id, phone')
      .eq('account_id', c.account_id)
      .in('id', part);
    for (const row of contacts ?? [])
      phoneOf.set(row.id as string, digitsOf(row.phone as string));
    const { data: leads } = await db
      .from('prospect_leads')
      .select('id, contact_id')
      .eq('account_id', c.account_id)
      .in('contact_id', part);
    for (const row of leads ?? [])
      leadOf.set(row.contact_id as string, row.id as string);
  }

  const optedOut = new Set<string>();
  const phones = [...new Set([...phoneOf.values()].filter(Boolean))];
  for (const part of chunked(phones)) {
    const { data } = await db
      .from('prospect_optouts')
      .select('phone_normalized')
      .eq('account_id', c.account_id)
      .in('phone_normalized', part);
    for (const row of data ?? []) optedOut.add(row.phone_normalized as string);
  }

  let queued = 0;
  let skipped = 0;
  const rows = fresh.map((d) => {
    const phone = phoneOf.get(d.contact_id as string) ?? '';
    const status = !phone
      ? 'skipped'
      : optedOut.has(phone)
        ? 'opted_out'
        : 'queued';
    if (status === 'queued') queued += 1;
    else skipped += 1;
    return {
      campaign_id: c.id,
      account_id: c.account_id,
      deal_id: d.id,
      contact_id: d.contact_id,
      lead_id: leadOf.get(d.contact_id as string) ?? null,
      status,
      error: status === 'skipped' ? 'Contato sem telefone' : null,
    };
  });
  for (const part of chunked(rows)) {
    await db.from('prospect_campaign_recipients').upsert(part, {
      onConflict: 'campaign_id,contact_id',
      ignoreDuplicates: true,
    });
  }
  return { queued, skipped };
}

// ---------- replies and opt-outs ----------

export async function refreshReplies(
  db: SupabaseClient,
  c: Campaign,
  now: Date
): Promise<{ replied: number; optedOut: number }> {
  const since = new Date(now.getTime() - REPLY_LOOKBACK_MS).toISOString();
  const { data: cand } = await db
    .from('prospect_campaign_recipients')
    .select('id, contact_id, deal_id, conversation_id, first_sent_at')
    .eq('campaign_id', c.id)
    .in('status', ['queued', 'sent'])
    .not('first_sent_at', 'is', null)
    .not('conversation_id', 'is', null)
    .gte('last_sent_at', since)
    .limit(300);
  const list = (cand ?? []) as Pick<
    Recipient,
    'id' | 'contact_id' | 'deal_id' | 'conversation_id' | 'first_sent_at'
  >[];
  if (list.length === 0) return { replied: 0, optedOut: 0 };

  const byConversation = new Map<
    string,
    { at: string; text: string | null }[]
  >();
  for (const part of chunked([
    ...new Set(list.map((r) => r.conversation_id as string)),
  ])) {
    const { data } = await db
      .from('messages')
      .select('conversation_id, created_at, content_text')
      .in('conversation_id', part)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: true })
      .limit(2000);
    for (const m of data ?? []) {
      const key = m.conversation_id as string;
      const arr = byConversation.get(key) ?? [];
      arr.push({
        at: m.created_at as string,
        text: m.content_text as string | null,
      });
      byConversation.set(key, arr);
    }
  }

  let replied = 0;
  let optedOut = 0;
  for (const r of list) {
    const answers = (
      byConversation.get(r.conversation_id as string) ?? []
    ).filter((m) => m.at > (r.first_sent_at as string));
    if (answers.length === 0) continue;

    if (answers.some((m) => isOptOutText(m.text))) {
      const { data: contact } = await db
        .from('contacts')
        .select('phone')
        .eq('id', r.contact_id)
        .maybeSingle();
      const phone = digitsOf(contact?.phone as string | undefined);
      if (phone) {
        await db.from('prospect_optouts').upsert(
          {
            account_id: c.account_id,
            phone_normalized: phone,
            source: 'reply',
          },
          {
            onConflict: 'account_id,phone_normalized',
            ignoreDuplicates: true,
          }
        );
      }
      await db
        .from('prospect_campaign_recipients')
        .update({ status: 'opted_out', replied_at: answers[0].at })
        .eq('id', r.id);
      optedOut += 1;
      continue;
    }

    if (!c.stop_on_reply) continue;
    await db
      .from('prospect_campaign_recipients')
      .update({ status: 'replied', replied_at: answers[0].at })
      .eq('id', r.id);
    replied += 1;
    if (c.reply_stage_id && r.deal_id) {
      await db
        .from('deals')
        .update({ stage_id: c.reply_stage_id })
        .eq('id', r.deal_id)
        .in('stage_id', [
          c.stage_id,
          ...(c.sent_stage_id ? [c.sent_stage_id] : []),
        ]);
    }
  }
  return { replied, optedOut };
}

// ---------- one send ----------

async function pause(db: SupabaseClient, c: Campaign, reason: string) {
  await db
    .from('prospect_campaigns')
    .update({ status: 'paused', paused_reason: reason })
    .eq('id', c.id);
}

export async function tickCampaign(
  campaignId: string,
  deps: EngineDeps
): Promise<TickResult> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const rng = deps.rng ?? Math.random;
  const send = deps.send ?? defaultSender;
  const check = deps.check ?? checkConnection;
  const nowIso = now.toISOString();
  const result = (outcome: TickOutcome, detail?: string): TickResult => ({
    campaignId,
    outcome,
    detail,
  });

  const { data } = await db
    .from('prospect_campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  const c = data as Campaign | null;
  if (!c || c.status !== 'running') return result('inactive');

  if (!isInWindow(now, windowOf(c))) return result('outside_window');
  if (c.next_send_at && new Date(c.next_send_at) > now)
    return result('waiting');

  const cap = effectiveDailyCap(
    c.daily_limit,
    c.warmup,
    c.started_at ? new Date(c.started_at) : null,
    now,
    c.timezone
  );
  const { count: sentToday } = await db
    .from('prospect_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', c.id)
    .gte('last_sent_at', localDayStart(now, c.timezone).toISOString());
  if ((sentToday ?? 0) >= cap)
    return result('daily_cap', `${sentToday}/${cap}`);

  const connection = await check(db, c);
  if (connection !== 'ok') {
    await pause(
      db,
      c,
      connection === 'missing' ? 'no_connection' : 'disconnected'
    );
    return result('paused', connection);
  }

  // Reserve the campaign so two overlapping scheduler calls cannot both send.
  const hold = new Date(now.getTime() + 90_000).toISOString();
  const { data: reserved } = await db
    .from('prospect_campaigns')
    .update({ next_send_at: hold })
    .eq('id', c.id)
    .eq('status', 'running')
    .or(`next_send_at.is.null,next_send_at.lte.${nowIso}`)
    .select('id');
  if (!reserved?.length) return result('waiting');
  const release = () =>
    db
      .from('prospect_campaigns')
      .update({ next_send_at: nowIso })
      .eq('id', c.id);

  await enqueueStage(db, c);
  await refreshReplies(db, c, now);

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: rows } = await db
      .from('prospect_campaign_recipients')
      .select('*')
      .eq('campaign_id', c.id)
      .eq('status', 'queued')
      .lte('next_due_at', nowIso)
      .order('step', { ascending: false })
      .order('next_due_at', { ascending: true })
      .limit(1);
    const r = (rows?.[0] ?? null) as Recipient | null;
    if (!r) {
      await release();
      return result('idle');
    }

    // Claim the row; if another worker got it first, try the next one.
    const { data: claimed } = await db
      .from('prospect_campaign_recipients')
      .update({
        next_due_at: new Date(now.getTime() + CLAIM_MS).toISOString(),
        attempts: r.attempts + 1,
      })
      .eq('id', r.id)
      .eq('status', 'queued')
      .lte('next_due_at', nowIso)
      .select('id');
    if (!claimed?.length) continue;

    const skip = async (
      status: 'skipped' | 'opted_out',
      error: string | null
    ) => {
      await db
        .from('prospect_campaign_recipients')
        .update({ status, error })
        .eq('id', r.id);
    };

    const { data: contact } = await db
      .from('contacts')
      .select('id, name, phone')
      .eq('id', r.contact_id)
      .eq('account_id', c.account_id)
      .maybeSingle();
    const phone = digitsOf(contact?.phone as string | undefined);
    if (!contact || !phone) {
      await skip('skipped', 'Contato sem telefone');
      continue;
    }
    const { data: optout } = await db
      .from('prospect_optouts')
      .select('phone_normalized')
      .eq('account_id', c.account_id)
      .eq('phone_normalized', phone)
      .maybeSingle();
    if (optout) {
      await skip('opted_out', null);
      continue;
    }

    const stepText =
      r.step === 0 ? c.message_text : (c.followups[r.step - 1]?.text ?? null);
    if (c.kind === 'text' && !stepText) {
      await skip('skipped', 'Mensagem não definida para esta etapa');
      continue;
    }
    const { data: lead } = r.lead_id
      ? await db
          .from('prospect_leads')
          .select('name, category, city, rating, review_count')
          .eq('id', r.lead_id)
          .maybeSingle()
      : { data: null };
    const vars = variablesFor(lead, contact.name as string | null);
    const text = stepText
      ? renderMessage(stepText, vars, rng, c.include_optout)
      : '';
    const templateParams = (c.template_vars as VariableName[]).map(
      (v) => vars[v] ?? ''
    );

    try {
      const sent = await send({
        campaign: c,
        contact: {
          id: contact.id as string,
          name: contact.name as string | null,
          phone,
        },
        text,
        templateParams,
      });
      const delay = c.followups[r.step]?.delay_days;
      const hasMore = delay !== undefined;
      await db
        .from('prospect_campaign_recipients')
        .update({
          status: hasMore ? 'queued' : 'sent',
          step: r.step + 1,
          attempts: 0,
          error: null,
          first_sent_at: r.first_sent_at ?? nowIso,
          last_sent_at: nowIso,
          next_due_at: hasMore
            ? new Date(now.getTime() + delay * 86_400_000).toISOString()
            : nowIso,
          conversation_id: sent.conversationId ?? r.conversation_id,
        })
        .eq('id', r.id);
      if (r.step === 0 && c.sent_stage_id && r.deal_id) {
        await db
          .from('deals')
          .update({ stage_id: c.sent_stage_id })
          .eq('id', r.deal_id)
          .eq('stage_id', c.stage_id);
      }
      await db
        .from('prospect_campaigns')
        .update({
          next_send_at: new Date(
            now.getTime() + nextDelayMs(c.min_interval_s, c.max_interval_s, rng)
          ).toISOString(),
          consecutive_errors: 0,
        })
        .eq('id', c.id);
      return result('sent', r.id);
    } catch (err) {
      const message = (
        err instanceof Error ? err.message : 'Falha ao enviar'
      ).slice(0, 300);
      const giveUp = r.attempts + 1 >= MAX_ATTEMPTS;
      await db
        .from('prospect_campaign_recipients')
        .update({
          status: giveUp ? 'failed' : 'queued',
          error: message,
          next_due_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
        })
        .eq('id', r.id);
      const errors = c.consecutive_errors + 1;
      await db
        .from('prospect_campaigns')
        .update({
          consecutive_errors: errors,
          next_send_at: new Date(
            now.getTime() + c.max_interval_s * 1000
          ).toISOString(),
          ...(errors >= ERRORS_BEFORE_PAUSE
            ? { status: 'paused', paused_reason: 'errors' }
            : {}),
        })
        .eq('id', c.id);
      return result('failed', message);
    }
  }
  await release();
  return result('idle');
}

export async function tickAll(deps: EngineDeps): Promise<TickResult[]> {
  const { data } = await deps.db
    .from('prospect_campaigns')
    .select('id')
    .eq('status', 'running')
    .limit(50);
  const results: TickResult[] = [];
  for (const row of data ?? []) {
    try {
      results.push(await tickCampaign(row.id as string, deps));
    } catch (err) {
      console.error('[prospect/engine]', row.id, err);
      results.push({
        campaignId: row.id as string,
        outcome: 'failed',
        detail: 'erro interno',
      });
    }
  }
  return results;
}
