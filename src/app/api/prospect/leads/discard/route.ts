import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { discardLeads, parseIds } from '@/lib/prospect/service';

/** POST { ids (max 200) } hides the leads from the default list. */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({
      discarded: await discardLeads(ctx, parseIds(body?.ids)),
    });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
