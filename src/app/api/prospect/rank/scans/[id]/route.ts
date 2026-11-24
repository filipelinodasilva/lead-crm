import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { deleteScan, getScan } from '@/lib/prospect/rank/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireRole('viewer');
    return NextResponse.json(await getScan(ctx, id));
  } catch (err) {
    return prospectErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireRole('agent');
    await deleteScan(ctx, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
