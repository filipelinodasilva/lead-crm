import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { prospectErrorResponse } from '@/lib/prospect/http';
import {
  campaignCounts,
  createCampaign,
  parseCampaignInput,
} from '@/lib/prospect/campaign/service';
import { localDayStart } from '@/lib/prospect/campaign/schedule';
import type { Campaign } from '@/lib/prospect/campaign/types';
import { ProspectError } from '@/lib/prospect/types';

/** GET → every campaign of the account with its recipient counters. */
export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const { data, error } = await ctx.supabase
      .from('prospect_campaigns')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error)
      throw new ProspectError('Não foi possível listar os disparos.', 500);
    const campaigns = (data ?? []) as Campaign[];
    const counts = await campaignCounts(
      ctx,
      campaigns.map((c) => c.id),
      localDayStart(new Date(), 'America/Sao_Paulo').toISOString()
    );
    return NextResponse.json({
      campaigns: campaigns.map((c) => ({ ...c, counts: counts[c.id] })),
    });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}

/** POST { name, pipelineId, stageId, connectionId, messageText, ... } creates a draft campaign. */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await req.json().catch(() => {
      throw new ProspectError('Corpo da requisição inválido.');
    });
    const campaign = await createCampaign(ctx, parseCampaignInput(body));
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
