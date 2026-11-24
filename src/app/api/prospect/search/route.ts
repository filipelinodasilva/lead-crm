import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { parseSearchInput, runSearch } from '@/lib/prospect/service';
import { ProspectError } from '@/lib/prospect/types';

export const maxDuration = 60;

/** POST { query, location, maxResults? } runs a search and stores the leads found. */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(
      `prospect-search:${ctx.userId}`,
      RATE_LIMITS.prospectSearch
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await req.json().catch(() => {
      throw new ProspectError('Corpo da requisição inválido.');
    });
    const summary = await runSearch(ctx, parseSearchInput(body));

    return NextResponse.json(summary);
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
