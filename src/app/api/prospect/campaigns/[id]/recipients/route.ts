import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { getCampaign, listRecipients } from '@/lib/prospect/campaign/service';

const STATUSES = [
  'queued',
  'sent',
  'replied',
  'opted_out',
  'failed',
  'skipped',
];

/** GET ?page=1&status=sent → recipients of a campaign, newest activity first (50 per page). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireRole('viewer');
    await getCampaign(ctx, id);
    const search = new URL(req.url).searchParams;
    const page = Math.max(1, Math.floor(Number(search.get('page')) || 1));
    const status = search.get('status');
    return NextResponse.json(
      await listRecipients(
        ctx,
        id,
        page,
        50,
        status && STATUSES.includes(status) ? status : undefined
      )
    );
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
