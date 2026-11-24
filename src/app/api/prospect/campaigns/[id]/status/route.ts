import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { prospectErrorResponse } from '@/lib/prospect/http';
import {
  setCampaignStatus,
  type StatusAction,
} from '@/lib/prospect/campaign/service';
import { ProspectError } from '@/lib/prospect/types';

const ACTIONS: StatusAction[] = ['start', 'pause', 'finish'];

/** POST { action: "start" | "pause" | "finish" } */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireRole('agent');
    const body = await req.json().catch(() => ({}));
    if (!ACTIONS.includes(body?.action))
      throw new ProspectError('Ação inválida.');
    return NextResponse.json({
      campaign: await setCampaignStatus(ctx, id, body.action),
    });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
