import { buildSignatureHeader } from '@/lib/webhooks/sign';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { LeadRow } from './types';

// "Send to webhook": the selected leads are POSTed in batches to an HTTPS
// endpoint of the account's choice (n8n, Make, Zapier, own API), signed with
// the same scheme as the public-API webhooks:
//   X-LeadCRM-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
// over `${t}.${rawBody}`.

export const WEBHOOK_BATCH_SIZE = 50;
export const SIGNATURE_HEADER = 'X-LeadCRM-Signature';

/** Hosts the operator allows even when private (e.g. an n8n on the same server). */
export function allowedPrivateHosts(
  env: Record<string, string | undefined> = process.env
): string[] {
  return (env.PROSPECT_WEBHOOK_ALLOW_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Validate a webhook target. https only, unless the host is on the
 * operator's allow-list (then http is accepted too). Rejects localhost and
 * private addresses unless allow-listed, so a user cannot aim the server at
 * its own internal network.
 */
export async function normalizeProspectWebhookUrl(
  input: unknown,
  allow: string[] = allowedPrivateHosts()
): Promise<string | null> {
  if (typeof input !== 'string') return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const allowed = allow.includes(host);
  if (url.protocol !== 'https:' && !(allowed && url.protocol === 'http:')) {
    return null;
  }
  if (url.username || url.password) return null;
  if (!(await isDeliverableUrl(url.toString(), { allowPrivateHosts: allow }))) {
    return null;
  }
  return url.toString();
}

export function leadToWebhookPayload(l: LeadRow) {
  return {
    id: l.id,
    place_id: l.place_id,
    name: l.name,
    category: l.category,
    address: l.address,
    city: l.city,
    state: l.state,
    lat: l.lat,
    lng: l.lng,
    phone: l.phone,
    phone_e164: l.phone_e164,
    phone_kind: l.phone_kind,
    website: l.website,
    has_website: Boolean(l.website),
    rating: l.rating,
    review_count: l.review_count,
    business_status: l.business_status,
    maps_url: l.maps_url,
    status: l.status,
    cnpj: l.cnpj ?? null,
    cnpj_match_status: l.cnpj_match_status ?? null,
    cnpj_data: l.cnpj_match_status === 'matched' ? (l.cnpj_data ?? null) : null,
    site_data: l.site_data ?? null,
    collected_at: l.collected_at,
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

export interface WebhookDelivery {
  delivered: string[];
  failed: { ids: string[]; error: string }[];
}

export async function deliverLeadBatches(opts: {
  url: string;
  secret: string;
  leads: LeadRow[];
  fetchImpl?: typeof fetch;
  nowSeconds?: () => number;
}): Promise<WebhookDelivery> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const batches = chunk(opts.leads, WEBHOOK_BATCH_SIZE);
  const result: WebhookDelivery = { delivered: [], failed: [] };

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const ids = batch.map((l) => l.id);
    const body = JSON.stringify({
      event: 'prospect.leads',
      batch: i + 1,
      batches: batches.length,
      count: batch.length,
      leads: batch.map(leadToWebhookPayload),
    });
    try {
      const res = await fetchImpl(opts.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'LeadCRM/1.0',
          [SIGNATURE_HEADER]: buildSignatureHeader(body, opts.secret, now()),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status >= 200 && res.status < 300) result.delivered.push(...ids);
      else result.failed.push({ ids, error: `HTTP ${res.status}` });
    } catch (err) {
      result.failed.push({
        ids,
        error: err instanceof Error ? err.message : 'request failed',
      });
    }
  }
  return result;
}
