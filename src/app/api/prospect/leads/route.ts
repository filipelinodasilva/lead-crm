import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { applyLeadFilters, parseLeadFilters } from '@/lib/prospect/filters';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { ProspectError, type LeadRow } from '@/lib/prospect/types';

const PAGE_SIZES = [25, 50, 100];

/**
 * GET ?page=1&pageSize=50&<filters> → { leads, total, categories }
 * `categories` lists the distinct categories in the account so the filter can offer them.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireRole('viewer');
    const params = new URL(req.url).searchParams;
    const filters = parseLeadFilters(params);
    const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
    const asked = Number(params.get('pageSize'));
    const pageSize = PAGE_SIZES.includes(asked) ? asked : 50;
    const from = (page - 1) * pageSize;

    const { data, count, error } = await applyLeadFilters(
      ctx.supabase
        .from('prospect_leads')
        .select('*', { count: 'exact' })
        .eq('account_id', ctx.accountId),
      filters
    )
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + pageSize - 1);
    if (error)
      throw new ProspectError('Não foi possível listar os leads.', 500);

    const { data: cats } = await ctx.supabase
      .from('prospect_leads')
      .select('category')
      .eq('account_id', ctx.accountId)
      .not('category', 'is', null)
      .limit(2000);
    const categories = [
      ...new Set((cats ?? []).map((c) => c.category as string)),
    ].sort();

    return NextResponse.json({
      leads: (data ?? []) as LeadRow[],
      total: count ?? 0,
      page,
      pageSize,
      categories,
    });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
