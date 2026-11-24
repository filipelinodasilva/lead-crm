import type { SupabaseClient } from '@supabase/supabase-js';

import { getConnectionById } from '@/lib/whatsapp/connections';
import { ProspectError } from '../types';
import { enqueueStage } from './engine';
import { VARIABLES, validateMessageText, type VariableName } from './message';
import { hhmmToMinutes, isValidTimezone } from './schedule';
import { checkConnection, senderMode } from './sender';
import {
  MAX_FOLLOWUPS,
  type Campaign,
  type FollowUp,
  type Recipient,
} from './types';

export interface CampaignContext {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fields the user edits, validated and shaped like the table columns. */
export interface ParsedCampaign {
  name: string;
  pipeline_id: string;
  stage_id: string;
  sent_stage_id: string | null;
  reply_stage_id: string | null;
  connection_id: string | null;
  message_text: string | null;
  template_name: string | null;
  template_language: string;
  template_vars: VariableName[];
  followups: FollowUp[];
  include_optout: boolean;
  stop_on_reply: boolean;
  daily_limit: number;
  warmup: boolean;
  window_start_min: number;
  window_end_min: number;
  days: number[];
  timezone: string;
  min_interval_s: number;
  max_interval_s: number;
}

function uuidOrNull(
  value: unknown,
  label: string,
  required = false
): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ProspectError(`${label} é obrigatório.`);
    return null;
  }
  if (typeof value !== 'string' || !UUID.test(value))
    throw new ProspectError(`${label} inválido.`);
  return value;
}

function intIn(
  value: unknown,
  min: number,
  max: number,
  label: string
): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ProspectError(`${label} deve ficar entre ${min} e ${max}.`);
  }
  return n;
}

/** Validate the campaign form. `kind` is decided later from the connection type. */
export function parseCampaignInput(
  body: unknown
): ParsedCampaign & { kind?: undefined } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length < 2 || name.length > 80)
    throw new ProspectError('Dê um nome ao disparo (2 a 80 caracteres).');

  const followupsRaw = Array.isArray(b.followups) ? b.followups : [];
  if (followupsRaw.length > MAX_FOLLOWUPS) {
    throw new ProspectError(
      `No máximo ${MAX_FOLLOWUPS} mensagens de acompanhamento.`
    );
  }
  const followups: FollowUp[] = followupsRaw.map((f, i) => {
    const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text.trim() : '';
    const error = validateMessageText(text);
    if (error) throw new ProspectError(`Acompanhamento ${i + 1}: ${error}`);
    return {
      delay_days: intIn(
        o.delayDays ?? o.delay_days,
        1,
        30,
        `Prazo do acompanhamento ${i + 1}`
      ),
      text,
    };
  });

  const messageText =
    typeof b.messageText === 'string' ? b.messageText.trim() : '';
  const templateName =
    typeof b.templateName === 'string' ? b.templateName.trim() : '';
  const templateVars = (
    Array.isArray(b.templateVars) ? b.templateVars : []
  ).map(String);
  for (const v of templateVars) {
    if (!(VARIABLES as readonly string[]).includes(v))
      throw new ProspectError(`Variável desconhecida: ${v}.`);
  }
  if (templateVars.length > 10)
    throw new ProspectError('Variáveis demais no modelo.');

  const startMin = hhmmToMinutes(String(b.windowStart ?? '09:00'));
  const endMin = hhmmToMinutes(String(b.windowEnd ?? '18:00'));
  if (startMin === null || endMin === null || endMin <= startMin) {
    throw new ProspectError(
      'A janela de envio é inválida: o fim deve ser depois do início.'
    );
  }
  const days = [
    ...new Set((Array.isArray(b.days) ? b.days : [1, 2, 3, 4, 5]).map(Number)),
  ]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort();
  if (days.length === 0)
    throw new ProspectError('Escolha ao menos um dia da semana.');
  const timezone =
    typeof b.timezone === 'string' && b.timezone
      ? b.timezone
      : 'America/Sao_Paulo';
  if (!isValidTimezone(timezone))
    throw new ProspectError('Fuso horário inválido.');
  const minInterval = intIn(
    b.minIntervalSeconds ?? 45,
    10,
    3600,
    'Intervalo mínimo'
  );
  const maxInterval = intIn(
    b.maxIntervalSeconds ?? 120,
    10,
    3600,
    'Intervalo máximo'
  );
  if (maxInterval < minInterval)
    throw new ProspectError(
      'O intervalo máximo deve ser maior ou igual ao mínimo.'
    );

  return {
    name,
    pipeline_id: uuidOrNull(b.pipelineId, 'Pipeline', true) as string,
    stage_id: uuidOrNull(b.stageId, 'Etapa', true) as string,
    sent_stage_id: uuidOrNull(b.sentStageId, 'Etapa depois do envio'),
    reply_stage_id: uuidOrNull(b.replyStageId, 'Etapa quando responder'),
    connection_id: uuidOrNull(
      b.connectionId,
      'Conexão do WhatsApp',
      senderMode() === 'real'
    ),
    message_text: messageText || null,
    template_name: templateName || null,
    template_language:
      typeof b.templateLanguage === 'string' && b.templateLanguage
        ? b.templateLanguage
        : 'pt_BR',
    template_vars: templateVars as VariableName[],
    followups,
    include_optout: b.includeOptout !== false,
    stop_on_reply: b.stopOnReply !== false,
    daily_limit: intIn(b.dailyLimit ?? 30, 1, 500, 'Limite por dia'),
    warmup: b.warmup !== false,
    window_start_min: startMin,
    window_end_min: endMin,
    days,
    timezone,
    min_interval_s: minInterval,
    max_interval_s: maxInterval,
  };
}

/** Cross-checks that need the database: ownership, connection type and message kind. */
async function resolveKind(
  ctx: CampaignContext,
  p: ParsedCampaign
): Promise<'text' | 'template'> {
  const { supabase, accountId } = ctx;
  const { data: pipeline } = await supabase
    .from('pipelines')
    .select('id')
    .eq('id', p.pipeline_id)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!pipeline) throw new ProspectError('Pipeline não encontrado.', 404);

  const stageIds = [p.stage_id, p.sent_stage_id, p.reply_stage_id].filter(
    Boolean
  ) as string[];
  const { data: stages } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', p.pipeline_id)
    .in('id', stageIds);
  if ((stages?.length ?? 0) !== new Set(stageIds).size) {
    throw new ProspectError(
      'As etapas escolhidas precisam ser do mesmo pipeline.'
    );
  }

  let kind: 'text' | 'template' = 'text';
  if (p.connection_id) {
    const conn = await getConnectionById(supabase, accountId, p.connection_id);
    if (!conn)
      throw new ProspectError('Conexão do WhatsApp não encontrada.', 404);
    kind = conn.provider === 'meta' ? 'template' : 'text';
  }

  if (kind === 'text') {
    const error = validateMessageText(p.message_text ?? '');
    if (error) throw new ProspectError(error);
  } else {
    if (!p.template_name)
      throw new ProspectError(
        'Na API oficial, escolha um modelo de mensagem aprovado.'
      );
    if (p.followups.length > 0) {
      throw new ProspectError(
        'Mensagens de acompanhamento só existem na conexão por QR code.'
      );
    }
    const { data: template } = await supabase
      .from('message_templates')
      .select('status')
      .eq('account_id', accountId)
      .eq('name', p.template_name)
      .ilike('status', 'approved')
      .limit(1);
    if (!template?.length)
      throw new ProspectError('O modelo escolhido não está aprovado.');
  }
  return kind;
}

export async function createCampaign(
  ctx: CampaignContext,
  input: ParsedCampaign
): Promise<Campaign> {
  const kind = await resolveKind(ctx, input);
  const { data, error } = await ctx.supabase
    .from('prospect_campaigns')
    .insert({
      ...input,
      kind,
      account_id: ctx.accountId,
      created_by: ctx.userId,
    })
    .select('*')
    .single();
  if (error || !data)
    throw new ProspectError('Não foi possível criar o disparo.', 500);
  return data as Campaign;
}

export async function getCampaign(
  ctx: CampaignContext,
  id: string
): Promise<Campaign> {
  const { data } = await ctx.supabase
    .from('prospect_campaigns')
    .select('*')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!data) throw new ProspectError('Disparo não encontrado.', 404);
  return data as Campaign;
}

export async function updateCampaign(
  ctx: CampaignContext,
  id: string,
  input: ParsedCampaign
): Promise<Campaign> {
  const current = await getCampaign(ctx, id);
  if (current.status === 'running')
    throw new ProspectError('Pause o disparo antes de editar.');
  const kind = await resolveKind(ctx, input);
  const { data, error } = await ctx.supabase
    .from('prospect_campaigns')
    .update({ ...input, kind })
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('*')
    .single();
  if (error || !data)
    throw new ProspectError('Não foi possível salvar o disparo.', 500);
  return data as Campaign;
}

export async function deleteCampaign(
  ctx: CampaignContext,
  id: string
): Promise<void> {
  const current = await getCampaign(ctx, id);
  if (current.status === 'running')
    throw new ProspectError('Pause o disparo antes de apagar.');
  await ctx.supabase
    .from('prospect_campaigns')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId);
}

export type StatusAction = 'start' | 'pause' | 'finish';

export async function setCampaignStatus(
  ctx: CampaignContext,
  id: string,
  action: StatusAction
): Promise<Campaign> {
  const c = await getCampaign(ctx, id);
  let patch: Record<string, unknown>;
  if (action === 'start') {
    if (c.status === 'done')
      throw new ProspectError('Este disparo já foi encerrado. Crie outro.');
    const connection = await checkConnection(ctx.supabase, c);
    if (connection === 'missing')
      throw new ProspectError(
        'Escolha uma conexão de WhatsApp para este disparo.'
      );
    if (connection === 'disconnected') {
      throw new ProspectError(
        'O WhatsApp está desconectado. Leia o QR code de novo em Configurações antes de iniciar.'
      );
    }
    // Start counting the warm-up from the first start, not from each resume.
    patch = {
      status: 'running',
      paused_reason: null,
      consecutive_errors: 0,
      next_send_at: new Date().toISOString(),
      started_at: c.started_at ?? new Date().toISOString(),
    };
    await enqueueStage(ctx.supabase, c);
  } else if (action === 'pause') {
    patch = { status: 'paused', paused_reason: 'manual' };
  } else {
    patch = {
      status: 'done',
      finished_at: new Date().toISOString(),
      paused_reason: null,
    };
  }
  const { data, error } = await ctx.supabase
    .from('prospect_campaigns')
    .update(patch)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('*')
    .single();
  if (error || !data)
    throw new ProspectError(
      'Não foi possível mudar a situação do disparo.',
      500
    );
  return data as Campaign;
}

export interface CampaignCounts {
  queued: number;
  sent: number;
  replied: number;
  opted_out: number;
  failed: number;
  skipped: number;
  contacted: number;
  sentToday: number;
}

const EMPTY_COUNTS: CampaignCounts = {
  queued: 0,
  sent: 0,
  replied: 0,
  opted_out: 0,
  failed: 0,
  skipped: 0,
  contacted: 0,
  sentToday: 0,
};

/** Recipient counters per campaign, in one pass over the rows (capped at 20,000 per call). */
export async function campaignCounts(
  ctx: CampaignContext,
  ids: string[],
  dayStartIso: string
): Promise<Record<string, CampaignCounts>> {
  const out: Record<string, CampaignCounts> = Object.fromEntries(
    ids.map((i) => [i, { ...EMPTY_COUNTS }])
  );
  if (ids.length === 0) return out;
  for (let from = 0; from < 20_000; from += 1000) {
    const { data } = await ctx.supabase
      .from('prospect_campaign_recipients')
      .select('campaign_id, status, first_sent_at, last_sent_at')
      .eq('account_id', ctx.accountId)
      .in('campaign_id', ids)
      .order('id')
      .range(from, from + 999);
    for (const r of data ?? []) {
      const c = out[r.campaign_id as string];
      if (!c) continue;
      c[
        r.status as keyof Pick<
          CampaignCounts,
          'queued' | 'sent' | 'replied' | 'opted_out' | 'failed' | 'skipped'
        >
      ] += 1;
      if (r.first_sent_at) c.contacted += 1;
      if (r.last_sent_at && (r.last_sent_at as string) >= dayStartIso)
        c.sentToday += 1;
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function listRecipients(
  ctx: CampaignContext,
  id: string,
  page: number,
  pageSize: number,
  status?: string
): Promise<{
  recipients: (Recipient & {
    contact_name: string | null;
    contact_phone: string | null;
  })[];
  total: number;
}> {
  let query = ctx.supabase
    .from('prospect_campaign_recipients')
    .select('*, contact:contacts(name, phone)', { count: 'exact' })
    .eq('campaign_id', id)
    .eq('account_id', ctx.accountId);
  if (status) query = query.eq('status', status);
  const from = (page - 1) * pageSize;
  const { data, count, error } = await query
    .order('last_sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (error)
    throw new ProspectError('Não foi possível listar os destinatários.', 500);
  return {
    total: count ?? 0,
    recipients: (data ?? []).map((r) => {
      const { contact, ...rest } = r as Recipient & {
        contact?: { name: string | null; phone: string | null } | null;
      };
      return {
        ...rest,
        contact_name: contact?.name ?? null,
        contact_phone: contact?.phone ?? null,
      };
    }),
  };
}
