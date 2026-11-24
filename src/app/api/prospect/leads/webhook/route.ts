import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { parseIds, sendLeadsToWebhook } from '@/lib/prospect/service';

export const maxDuration = 60;

/** POST { ids (max 200) } sends the leads to the account's webhook, in signed batches of 50. */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(
      `prospect:${ctx.userId}`,
      RATE_LIMITS.prospect
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await req.json().catch(() => ({}));
    return NextResponse.json(
      await sendLeadsToWebhook(ctx, parseIds(body?.ids))
    );
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
