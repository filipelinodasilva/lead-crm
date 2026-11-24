import type { SupabaseClient } from '@supabase/supabase-js';

import { ProspectError, QuotaError } from '../types';
import { GRID_SIZES, SPACINGS_M, buildGrid } from './grid';
import {
  compareWithPrevious,
  summarize,
  topCompetitors,
  type PointResult,
} from './metrics';
import { resolveRankProvider } from './settings';

interface Ctx {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
}

export interface ScanInput {
  leadId: string;
  keyword: string;
  gridSize: number;
  spacingM: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseScanInput(body: unknown): ScanInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  const leadId = typeof b.leadId === 'string' ? b.leadId : '';
  if (!UUID.test(leadId)) throw new ProspectError('Escolha uma empresa.');
  const keyword = typeof b.keyword === 'string' ? b.keyword.trim() : '';
  if (keyword.length < 2 || keyword.length > 80) {
    throw new ProspectError('Informe a palavra-chave (2 a 80 caracteres).');
  }
  const gridSize = Number(b.gridSize ?? 5);
  if (!(GRID_SIZES as readonly number[]).includes(gridSize)) {
    throw new ProspectError('Tamanho da grade inválido (3, 5, 7 ou 9).');
  }
  const spacingM = Number(b.spacingM ?? 1000);
  if (!(SPACINGS_M as readonly number[]).includes(spacingM)) {
    throw new ProspectError('Distância entre pontos inválida.');
  }
  return { leadId, keyword, gridSize, spacingM };
}

/** Create a scan and its points. The caller runs the engine afterwards. */
export async function createScan(ctx: Ctx, input: ScanInput) {
  const { data: lead } = await ctx.supabase
    .from('prospect_leads')
    .select('id, place_id, name, lat, lng')
    .eq('id', input.leadId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!lead) throw new ProspectError('Empresa não encontrada.', 404);
  if (lead.lat == null || lead.lng == null) {
    throw new ProspectError('Esta empresa não tem localização no Google.');
  }

  const points = buildGrid(lead.lat, lead.lng, input.gridSize, input.spacingM);
  const resolved = await resolveRankProvider(ctx.supabase, ctx.accountId);
  if (resolved.provider.id !== 'mock' && resolved.remaining < points.length) {
    throw new QuotaError(
      `Faltam consultas no mês: esta medição usa ${points.length} e restam ${resolved.remaining}.`
    );
  }

  const { data: scan, error } = await ctx.supabase
    .from('prospect_rank_scans')
    .insert({
      account_id: ctx.accountId,
      created_by: ctx.userId,
      lead_id: lead.id,
      target_place_id: lead.place_id,
      target_name: lead.name,
      target_lat: lead.lat,
      target_lng: lead.lng,
      keyword: input.keyword,
      center_lat: lead.lat,
      center_lng: lead.lng,
      grid_size: input.gridSize,
      spacing_m: input.spacingM,
      provider: resolved.provider.id,
      points_total: points.length,
    })
    .select('id')
    .single();
  if (error || !scan)
    throw new ProspectError('Não foi possível criar a medição.', 500);

  const { error: pointsError } = await ctx.supabase
    .from('prospect_rank_points')
    .insert(
      points.map((p) => ({
        scan_id: scan.id,
        account_id: ctx.accountId,
        row_idx: p.row,
        col_idx: p.col,
        lat: p.lat,
        lng: p.lng,
      }))
    );
  if (pointsError) {
    await ctx.supabase.from('prospect_rank_scans').delete().eq('id', scan.id);
    throw new ProspectError('Não foi possível criar a medição.', 500);
  }
  return scan.id as string;
}

export async function listScans(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from('prospect_rank_scans')
    .select(
      'id, target_name, keyword, grid_size, spacing_m, provider, status, points_total, points_done, found_count, top3_count, avg_rank, created_at'
    )
    .eq('account_id', ctx.accountId)
    .order('created_at', { ascending: false })
    .limit(100);
  return data ?? [];
}

export async function getScan(ctx: Ctx, id: string) {
  if (!UUID.test(id)) throw new ProspectError('Medição não encontrada.', 404);
  const { data: scan } = await ctx.supabase
    .from('prospect_rank_scans')
    .select('*')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!scan) throw new ProspectError('Medição não encontrada.', 404);
  const { data } = await ctx.supabase
    .from('prospect_rank_points')
    .select('row_idx, col_idx, lat, lng, status, rank, top')
    .eq('scan_id', id)
    .order('row_idx')
    .order('col_idx');
  const points = (data ?? []) as PointResult[];
  const summary = summarize(points);

  // the previous finished scan for the same business and keyword
  const { data: previous } = await ctx.supabase
    .from('prospect_rank_scans')
    .select('avg_rank, top3_count, points_done')
    .eq('account_id', ctx.accountId)
    .eq('target_place_id', scan.target_place_id)
    .ilike('keyword', scan.keyword)
    .eq('status', 'done')
    .lt('created_at', scan.created_at)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    scan,
    points,
    summary,
    competitors: topCompetitors(points, scan.target_place_id),
    change: compareWithPrevious(previous, summary),
  };
}

export async function deleteScan(ctx: Ctx, id: string) {
  if (!UUID.test(id)) throw new ProspectError('Medição não encontrada.', 404);
  await ctx.supabase
    .from('prospect_rank_scans')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId);
}
