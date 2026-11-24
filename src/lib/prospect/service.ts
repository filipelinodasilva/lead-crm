import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { applyLeadFilters, type LeadFilters } from './filters';
import { loadSettings, resolveProvider } from './settings';
import {
  ProspectError,
  QuotaError,
  type LeadRow,
  type PlaceResult,
  type ProviderId,
} from './types';
import { deliverLeadBatches, normalizeProspectWebhookUrl } from './webhook';

export interface ProspectContext {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
}

export const MAX_IDS_PER_ACTION = 200;
export const MAX_IDS_LOOKUP = 5000;
const CHUNK = 100;

// ---------- search ----------

export interface SearchInput {
  query: string;
  location: string;
  maxResults: number;
}

/** Validate the search form. Throws `Error` with a user-facing message. */
export function parseSearchInput(body: unknown): SearchInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  const query = typeof b.query === 'string' ? b.query.trim() : '';
  const location = typeof b.location === 'string' ? b.location.trim() : '';
  if (query.length < 2 || query.length > 80) {
    throw new ProspectError('Informe o que procurar (2 a 80 caracteres).');
  }
  if (location.length < 2 || location.length > 120) {
    throw new ProspectError('Informe a cidade ou região (2 a 120 caracteres).');
  }
  const asked = Number(b.maxResults);
  const maxResults = Number.isFinite(asked)
    ? Math.min(60, Math.max(1, Math.floor(asked)))
    : 20;
  return { query, location, maxResults };
}

export interface SearchSummary {
  searchId: string;
  provider: ProviderId;
  found: number;
  created: number;
  updated: number;
  requests: number;
  warning?: string;
  usage: { used: number; cap: number } | null;
}

function leadRowFromPlace(
  p: PlaceResult,
  accountId: string,
  searchId: string,
  provider: ProviderId
) {
  return {
    account_id: accountId,
    search_id: searchId,
    provider,
    place_id: p.placeId,
    name: p.name,
    category: p.category,
    address: p.address,
    city: p.city,
    state: p.state,
    lat: p.lat,
    lng: p.lng,
    phone: p.phone,
    phone_e164: p.phoneE164,
    phone_kind: p.phoneKind,
    website: p.website,
    rating: p.rating,
    review_count: p.reviewCount,
    business_status: p.businessStatus,
    maps_url: p.mapsUrl,
    collected_at: new Date().toISOString(),
  };
}

export async function runSearch(
  ctx: ProspectContext,
  input: SearchInput
): Promise<SearchSummary> {
  const resolved = await resolveProvider(ctx.supabase, ctx.accountId);
  if (resolved.keySource !== 'none' && resolved.remaining <= 0) {
    throw new QuotaError(
      `Limite mensal de ${resolved.cap} buscas atingido. Aumente o limite em Configurações da prospecção.`
    );
  }

  const outcome = await resolved.provider.search(input, resolved.remaining);

  const { data: search, error: searchError } = await ctx.supabase
    .from('prospect_searches')
    .insert({
      account_id: ctx.accountId,
      created_by: ctx.userId,
      query: input.query,
      location_text: input.location,
      provider: resolved.provider.id,
      max_results: input.maxResults,
      found_count: outcome.places.length,
      requests_made: outcome.requests,
    })
    .select('id')
    .single();
  if (searchError || !search)
    throw new ProspectError('Não foi possível salvar a busca.', 500);
  const searchId = search.id as string;

  // Count what already exists so the summary can say how many are new.
  const placeIds = outcome.places.map((p) => p.placeId);
  const known = new Set<string>();
  for (let i = 0; i < placeIds.length; i += CHUNK) {
    const { data } = await ctx.supabase
      .from('prospect_leads')
      .select('place_id')
      .eq('account_id', ctx.accountId)
      .in('place_id', placeIds.slice(i, i + CHUNK));
    for (const row of data ?? []) known.add(row.place_id as string);
  }

  // Upsert only refreshes Google data. status, contact_id and webhook_sent_at
  // are not in the payload, so a re-collection never undoes the user's work.
  const rows = outcome.places.map((p) =>
    leadRowFromPlace(p, ctx.accountId, searchId, resolved.provider.id)
  );
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await ctx.supabase
      .from('prospect_leads')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'account_id,place_id' });
    if (error)
      throw new ProspectError('Não foi possível salvar os leads.', 500);
  }

  const created = placeIds.filter((id) => !known.has(id)).length;
  await ctx.supabase
    .from('prospect_searches')
    .update({ new_count: created })
    .eq('id', searchId);

  let used = resolved.used;
  if (outcome.requests > 0) {
    const { data } = await ctx.supabase.rpc('prospect_add_usage', {
      p_account_id: ctx.accountId,
      p_provider: resolved.provider.id,
      p_requests: outcome.requests,
    });
    if (typeof data === 'number') used = data;
  }

  return {
    searchId,
    provider: resolved.provider.id,
    found: outcome.places.length,
    created,
    updated: outcome.places.length - created,
    requests: outcome.requests,
    warning: outcome.warning,
    usage: resolved.keySource === 'none' ? null : { used, cap: resolved.cap },
  };
}

// ---------- selection ----------

/** Ids of every lead matching the filters ("select all N"), capped. */
export async function resolveLeadIds(
  ctx: ProspectContext,
  filters: LeadFilters
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  for (let from = 0; ids.length < MAX_IDS_LOOKUP; from += 1000) {
    const query = applyLeadFilters(
      ctx.supabase
        .from('prospect_leads')
        .select('id')
        .eq('account_id', ctx.accountId),
      filters
    )
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + 999);
    const { data, error } = await query;
    if (error)
      throw new ProspectError('Não foi possível listar os leads.', 500);
    for (const row of data ?? []) ids.push(row.id as string);
    if (!data || data.length < 1000)
      return { ids: ids.slice(0, MAX_IDS_LOOKUP), truncated: false };
  }
  return { ids: ids.slice(0, MAX_IDS_LOOKUP), truncated: true };
}

export function parseIds(value: unknown, max = MAX_IDS_PER_ACTION): string[] {
  if (!Array.isArray(value))
    throw new ProspectError('Selecione ao menos um lead.');
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [
    ...new Set(
      value.filter((v): v is string => typeof v === 'string' && uuid.test(v))
    ),
  ];
  if (ids.length === 0) throw new ProspectError('Selecione ao menos um lead.');
  if (ids.length > max)
    throw new ProspectError(`Envie no máximo ${max} leads por vez.`);
  return ids;
}

async function fetchLeads(
  ctx: ProspectContext,
  ids: string[]
): Promise<LeadRow[]> {
  const rows: LeadRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await ctx.supabase
      .from('prospect_leads')
      .select('*')
      .eq('account_id', ctx.accountId)
      .in('id', ids.slice(i, i + CHUNK));
    if (error) throw new ProspectError('Não foi possível ler os leads.', 500);
    rows.push(...((data ?? []) as LeadRow[]));
  }
  return rows;
}

export async function discardLeads(
  ctx: ProspectContext,
  ids: string[]
): Promise<number> {
  const { data, error } = await ctx.supabase
    .from('prospect_leads')
    .update({ status: 'discarded' })
    .eq('account_id', ctx.accountId)
    .in('id', ids)
    .select('id');
  if (error)
    throw new ProspectError('Não foi possível descartar os leads.', 500);
  return data?.length ?? 0;
}

// ---------- send to pipeline ----------

export interface PipelineSummary {
  added: number;
  createdContacts: number;
  existingContacts: number;
  skippedNoPhone: number;
  alreadyInPipeline: number;
  /** Open deals moved to the chosen stage (only with `moveExisting`). */
  moved: number;
  failed: number;
}

function dealNotes(l: LeadRow): string {
  return [
    l.category ? `Categoria: ${l.category}` : null,
    l.address ? `Endereço: ${l.address}` : null,
    l.rating !== null
      ? `Nota: ${l.rating} (${l.review_count} avaliações)`
      : null,
    `Site: ${l.website ?? 'não tem'}`,
    l.maps_url ? `Maps: ${l.maps_url}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function sendLeadsToPipeline(
  ctx: ProspectContext,
  input: {
    ids: string[];
    pipelineId: string;
    stageId: string;
    campaignTag?: string;
    /**
     * A lead that already has an open deal in this pipeline is moved to the
     * chosen stage instead of being skipped. Off for bulk sends, on when one
     * lead is placed from its side panel.
     */
    moveExisting?: boolean;
  }
): Promise<PipelineSummary> {
  const { supabase, accountId } = ctx;

  const { data: pipeline } = await supabase
    .from('pipelines')
    .select('id')
    .eq('id', input.pipelineId)
    .eq('account_id', accountId)
    .maybeSingle();
  const { data: stage } = pipeline
    ? await supabase
        .from('pipeline_stages')
        .select('id')
        .eq('id', input.stageId)
        .eq('pipeline_id', input.pipelineId)
        .maybeSingle()
    : { data: null };
  if (!pipeline || !stage)
    throw new ProspectError('Pipeline ou etapa não encontrada.');

  const leads = await fetchLeads(ctx, input.ids);
  const summary: PipelineSummary = {
    added: 0,
    createdContacts: 0,
    existingContacts: 0,
    skippedNoPhone: 0,
    alreadyInPipeline: 0,
    moved: 0,
    failed: 0,
  };

  const auditUserId = await resolveAuditUserId(supabase, accountId);
  const tagName = input.campaignTag?.trim();
  let tagId: string | undefined;
  if (tagName) {
    const { tagIdByKey } = await resolveImportTagIds(supabase, {
      accountId,
      userId: auditUserId,
      tagNames: [tagName],
      canCreateTags: true,
    });
    tagId = tagIdByKey.get(tagName.toLowerCase());
  }

  const contactByLead = new Map<string, string>();
  for (const lead of leads) {
    if (!lead.phone_e164) {
      summary.skippedNoPhone += 1;
      continue;
    }
    try {
      const contact = await findOrCreateContact(
        supabase,
        accountId,
        auditUserId,
        {
          phone: lead.phone_e164,
          name: lead.name,
          company: lead.name,
        }
      );
      contactByLead.set(lead.id, contact.id);
      if (contact.created) summary.createdContacts += 1;
      else summary.existingContacts += 1;
    } catch {
      summary.failed += 1;
    }
  }

  const contactIds = [...new Set(contactByLead.values())];
  const inPipeline = new Set<string>();
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const { data } = await supabase
      .from('deals')
      .select('contact_id')
      .eq('pipeline_id', input.pipelineId)
      .eq('status', 'open')
      .in('contact_id', contactIds.slice(i, i + CHUNK));
    for (const row of data ?? []) inPipeline.add(row.contact_id as string);
  }

  for (const lead of leads) {
    const contactId = contactByLead.get(lead.id);
    if (!contactId) continue;
    if (inPipeline.has(contactId)) {
      if (input.moveExisting) {
        const { error } = await supabase
          .from('deals')
          .update({ stage_id: input.stageId })
          .eq('account_id', accountId)
          .eq('pipeline_id', input.pipelineId)
          .eq('contact_id', contactId)
          .eq('status', 'open');
        if (error) summary.failed += 1;
        else summary.moved += 1;
      } else {
        summary.alreadyInPipeline += 1;
      }
    } else {
      const { error } = await supabase.from('deals').insert({
        user_id: ctx.userId,
        account_id: accountId,
        pipeline_id: input.pipelineId,
        stage_id: input.stageId,
        contact_id: contactId,
        title: lead.name,
        value: 0,
        notes: dealNotes(lead),
        status: 'open',
      });
      if (error) {
        summary.failed += 1;
        continue;
      }
      inPipeline.add(contactId);
      summary.added += 1;
    }
    if (tagId) {
      await addContactTagAndDispatch({
        db: supabase,
        accountId,
        contactId,
        tagId,
      });
    }
    await supabase
      .from('prospect_leads')
      .update({ status: 'in_pipeline', contact_id: contactId })
      .eq('id', lead.id);
  }
  return summary;
}

// ---------- send to webhook ----------

export interface WebhookSummary {
  delivered: number;
  failed: number;
  errors: string[];
}

export async function sendLeadsToWebhook(
  ctx: ProspectContext,
  ids: string[]
): Promise<WebhookSummary> {
  const settings = await loadSettings(ctx.supabase, ctx.accountId);
  if (!settings.webhookUrl || !settings.webhookSecret) {
    throw new ProspectError(
      'Configure o webhook em Configurações da prospecção.'
    );
  }
  const url = await normalizeProspectWebhookUrl(settings.webhookUrl);
  if (!url)
    throw new ProspectError(
      'O endereço do webhook não é válido ou não é permitido.'
    );

  const leads = await fetchLeads(ctx, ids);
  const result = await deliverLeadBatches({
    url,
    secret: settings.webhookSecret,
    leads,
  });
  if (result.delivered.length > 0) {
    await ctx.supabase
      .from('prospect_leads')
      .update({ webhook_sent_at: new Date().toISOString() })
      .eq('account_id', ctx.accountId)
      .in('id', result.delivered);
  }
  return {
    delivered: result.delivered.length,
    failed: result.failed.reduce((n, f) => n + f.ids.length, 0),
    errors: [...new Set(result.failed.map((f) => f.error))],
  };
}

// ---------- export ----------

export async function fetchLeadsForExport(
  ctx: ProspectContext,
  filters: LeadFilters,
  limit = 5000
): Promise<LeadRow[]> {
  const rows: LeadRow[] = [];
  for (let from = 0; rows.length < limit; from += 1000) {
    const { data, error } = await applyLeadFilters(
      ctx.supabase
        .from('prospect_leads')
        .select('*')
        .eq('account_id', ctx.accountId),
      filters
    )
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + 999);
    if (error) throw new ProspectError('Não foi possível exportar.', 500);
    rows.push(...((data ?? []) as LeadRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows.slice(0, limit);
}
