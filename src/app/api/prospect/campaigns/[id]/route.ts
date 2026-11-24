import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { prospectErrorResponse } from '@/lib/prospect/http';
import {
  campaignCounts,
  deleteCampaign,
  getCampaign,
  parseCampaignInput,
  updateCampaign,
} from '@/lib/prospect/campaign/service';
import { localDayStart } from '@/lib/prospect/campaign/schedule';
import { ProspectError } from '@/lib/prospect/types';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireRole('viewer');
    const campaign = await getCampaign(ctx, id);
    const counts = await campaignCounts(
      ctx,
      [id],
      localDayStart(new Date(), campaign.timezone).toISOString()
    );
    return NextResponse.json({ campaign: { ...campaign, counts: counts[id] } });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}

/** PUT replaces the campaign settings. Only while it is not running. */
export async function PUT(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireRole('agent');
    const body = await req.json().catch(() => {
      throw new ProspectError('Corpo da requisição inválido.');
    });
    const campaign = await updateCampaign(ctx, id, parseCampaignInput(body));
    return NextResponse.json({ campaign });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireRole('agent');
    await deleteCampaign(ctx, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
