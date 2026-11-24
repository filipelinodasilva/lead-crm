import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { resolveProvider } from '@/lib/prospect/settings';

/** GET → which provider is active and this month's usage (no secrets). */
export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const resolved = await resolveProvider(ctx.supabase, ctx.accountId);
    const { data } = await ctx.supabase
      .from('prospect_settings')
      .select('webhook_url')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    return NextResponse.json({
      provider: resolved.provider.id,
      keySource: resolved.keySource,
      usage:
        resolved.keySource === 'none'
          ? null
          : { used: resolved.used, cap: resolved.cap },
      webhookConfigured: Boolean(data?.webhook_url),
      cnpjConfigured: false,
    });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
