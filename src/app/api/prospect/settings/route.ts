import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { DEFAULT_MONTHLY_CAP, loadSettings } from '@/lib/prospect/settings';
import { ProspectError } from '@/lib/prospect/types';
import { normalizeProspectWebhookUrl } from '@/lib/prospect/webhook';
import { encrypt } from '@/lib/whatsapp/encryption';

// Secrets never leave the server: the key comes back only as its last 4
// characters and the webhook secret is shown once, when it is created.

function view(s: Awaited<ReturnType<typeof loadSettings>>) {
  return {
    googleKeyConfigured: Boolean(s.googleApiKey),
    googleKeyLast4: s.googleApiKey ? s.googleApiKey.slice(-4) : null,
    monthlyRequestCap: s.monthlyRequestCap,
    rankRequestCap: s.rankRequestCap,
    dataforseoConfigured: Boolean(s.dataforseoLogin && s.dataforseoPassword),
    dataforseoLogin: s.dataforseoLogin,
    rankProvider: s.rankProvider,
    webhookUrl: s.webhookUrl,
    webhookSecretConfigured: Boolean(s.webhookSecret),
  };
}

export async function GET() {
  try {
    const ctx = await requireRole('admin');
    return NextResponse.json(
      view(await loadSettings(ctx.supabase, ctx.accountId))
    );
  } catch (err) {
    return prospectErrorResponse(err);
  }
}

/**
 * PUT { googleApiKey?, monthlyRequestCap?, webhookUrl?, rotateWebhookSecret? }
 * Omitted fields are left as they are. An empty string removes the key / webhook.
 */
export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const current = await loadSettings(ctx.supabase, ctx.accountId);
    const patch: Record<string, unknown> = {
      account_id: ctx.accountId,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    };
    let newSecret: string | undefined;

    if (typeof body.googleApiKey === 'string') {
      const key = body.googleApiKey.trim();
      if (key && (key.length < 20 || /\s/.test(key))) {
        throw new ProspectError('A chave do Google parece inválida.');
      }
      patch.google_api_key = key ? encrypt(key) : null;
    }

    if (body.monthlyRequestCap !== undefined) {
      const cap = Math.floor(Number(body.monthlyRequestCap));
      if (!Number.isFinite(cap) || cap < 0 || cap > 1_000_000) {
        throw new ProspectError('Limite mensal inválido.');
      }
      patch.monthly_request_cap = cap;
    }

    if (typeof body.dataforseoLogin === 'string') {
      const login = body.dataforseoLogin.trim();
      if (login.length > 120 || /\s/.test(login)) {
        throw new ProspectError('Login do DataForSEO inválido.');
      }
      patch.dataforseo_login = login || null;
      if (!login) patch.dataforseo_password = null;
    }
    if (
      typeof body.dataforseoPassword === 'string' &&
      body.dataforseoPassword.trim()
    ) {
      patch.dataforseo_password = encrypt(body.dataforseoPassword.trim());
    }
    if (body.rankProvider !== undefined) {
      if (
        !['auto', 'google', 'dataforseo'].includes(String(body.rankProvider))
      ) {
        throw new ProspectError('Provedor do ranking inválido.');
      }
      patch.rank_provider = body.rankProvider;
    }

    if (body.rankRequestCap !== undefined) {
      const cap = Math.floor(Number(body.rankRequestCap));
      if (!Number.isFinite(cap) || cap < 0 || cap > 1_000_000) {
        throw new ProspectError('Limite do ranking inválido.');
      }
      patch.rank_request_cap = cap;
    }

    if (typeof body.webhookUrl === 'string') {
      const raw = body.webhookUrl.trim();
      if (!raw) {
        patch.webhook_url = null;
        patch.webhook_secret = null;
      } else {
        const url = await normalizeProspectWebhookUrl(raw);
        if (!url) {
          throw new ProspectError(
            'Webhook inválido. Use um endereço https:// público.'
          );
        }
        patch.webhook_url = url;
        if (!current.webhookSecret || body.rotateWebhookSecret === true) {
          newSecret = `cpwh_${randomBytes(24).toString('hex')}`;
          patch.webhook_secret = encrypt(newSecret);
        }
      }
    } else if (body.rotateWebhookSecret === true && current.webhookUrl) {
      newSecret = `cpwh_${randomBytes(24).toString('hex')}`;
      patch.webhook_secret = encrypt(newSecret);
    }

    const { error } = await ctx.supabase
      .from('prospect_settings')
      .upsert(patch, { onConflict: 'account_id' });
    if (error)
      throw new ProspectError('Não foi possível salvar as configurações.', 500);

    const next = await loadSettings(ctx.supabase, ctx.accountId);
    return NextResponse.json({
      ...view(next),
      ...(newSecret ? { webhookSecret: newSecret } : {}),
      defaultMonthlyCap: DEFAULT_MONTHLY_CAP,
    });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
