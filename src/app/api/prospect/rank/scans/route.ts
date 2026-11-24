import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { processScan } from '@/lib/prospect/rank/engine';
import {
  createScan,
  listScans,
  parseScanInput,
} from '@/lib/prospect/rank/service';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { ProspectError } from '@/lib/prospect/types';

export const maxDuration = 60;

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    return NextResponse.json({ scans: await listScans(ctx) });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}

/** POST { leadId, keyword, gridSize?, spacingM? } creates a scan and measures what fits in this call. */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(
      `prospect-rank:${ctx.userId}`,
      RATE_LIMITS.prospectSearch
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await req.json().catch(() => {
      throw new ProspectError('Corpo da requisição inválido.');
    });
    const id = await createScan(ctx, parseScanInput(body));
    // the scheduler finishes whatever does not fit in this request
    await processScan(id, { db: supabaseAdmin() }, 81);
    return NextResponse.json({ id });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
