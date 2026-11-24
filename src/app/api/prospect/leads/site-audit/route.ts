import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { parseIds } from '@/lib/prospect/service';
import { auditLeadsWebsites } from '@/lib/prospect/site-audit-server';
import { ProspectError } from '@/lib/prospect/types';

export const maxDuration = 60;

/** POST { ids: string[], force?: boolean } -> analisa os sites dos leads selecionados (Fase 3). */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await req.json().catch(() => {
      throw new ProspectError('Corpo da requisição inválido.');
    });
    const ids = parseIds(body?.ids);
    const force = Boolean(body?.force);
    const summary = await auditLeadsWebsites({
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      ids,
      force,
    });
    return NextResponse.json(summary);
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
