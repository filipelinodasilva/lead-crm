import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { tickAll } from '@/lib/prospect/campaign/engine';
import { tickScans } from '@/lib/prospect/rank/engine';

export const maxDuration = 60;

/**
 * Scheduler entry point for mass sending. Hit it every minute with the shared
 * secret in `x-cron-secret` (the same AUTOMATION_CRON_SECRET the automations
 * use). Each call sends at most one message per running campaign.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected)
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '');
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = supabaseAdmin();
  const results = await tickAll({ db });
  const ranking = await tickScans({ db });
  return NextResponse.json({
    ranking,
    campaigns: results.length,
    sent: results.filter((r) => r.outcome === 'sent').length,
    results,
  });
}
