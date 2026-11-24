import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { parseLeadFilters } from '@/lib/prospect/filters';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { resolveLeadIds } from '@/lib/prospect/service';

/** POST { filters } → every lead id matching the filters ("select all N"), capped at 5,000. */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(
      await resolveLeadIds(ctx, parseLeadFilters(body?.filters))
    );
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
