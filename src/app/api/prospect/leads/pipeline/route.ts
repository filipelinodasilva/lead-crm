import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { parseIds, sendLeadsToPipeline } from '@/lib/prospect/service';
import { ProspectError } from '@/lib/prospect/types';

export const maxDuration = 60;

/**
 * POST { ids (max 200), pipelineId, stageId, campaignTag? }
 * Creates (or reuses) a contact and a deal per lead. The client sends a big
 * selection in chunks of 100 and shows progress.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(
      `prospect:${ctx.userId}`,
      RATE_LIMITS.prospect
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await req.json().catch(() => ({}));
    const ids = parseIds(body?.ids);
    if (
      typeof body?.pipelineId !== 'string' ||
      typeof body?.stageId !== 'string'
    ) {
      throw new ProspectError('Escolha o pipeline e a etapa.');
    }
    const campaignTag =
      typeof body.campaignTag === 'string'
        ? body.campaignTag.trim().slice(0, 60)
        : undefined;
    return NextResponse.json(
      await sendLeadsToPipeline(ctx, {
        ids,
        pipelineId: body.pipelineId,
        stageId: body.stageId,
        campaignTag,
        moveExisting: body.moveExisting === true,
      })
    );
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
