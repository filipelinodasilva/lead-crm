// Fase 3 (servidor): busca o site do lead com proteção anti-SSRF, limite de tempo e de bytes,
// extrai sinais comerciais/técnicos e grava em `prospect_leads.site_data`.
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  hasAnyAdPixel,
  normalizeWebsiteUrl,
  parseSiteHtml,
} from '@/lib/prospect/site-audit';
import { ProspectError, type LeadRow, type SiteAuditData } from '@/lib/prospect/types';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;
const MAX_BYTES = 512 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (compatible; LeadCRMSiteAudit/1.0)';

async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const slice =
        total + value.byteLength > maxBytes
          ? value.subarray(0, maxBytes - total)
          : value;
      chunks.push(slice);
      total += slice.byteLength;
      if (total >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

function unreachableResult(
  finalUrl: string | null,
  error: string,
  statusCode: number | null = null,
  responseMs: number | null = null
): SiteAuditData {
  return {
    reachable: false,
    status_code: statusCode,
    https: Boolean(finalUrl?.startsWith('https://')),
    response_ms: responseMs,
    final_url: finalUrl,
    title: null,
    has_meta_description: false,
    has_h1: false,
    has_whatsapp: false,
    whatsapp_links: [],
    pixels: { meta: false, gtm: false, ga_ads: false, tiktok: false },
    emails: [],
    socials: { instagram: null, facebook: null, linkedin: null, youtube: null },
    cms: null,
    error,
  };
}

export async function auditWebsite(rawUrl: string): Promise<SiteAuditData> {
  const initial = normalizeWebsiteUrl(rawUrl);
  if (!initial) {
    return unreachableResult(null, 'URL inválida');
  }

  let currentUrl = initial;
  const started = Date.now();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safe = await isDeliverableUrl(currentUrl);
    if (!safe) {
      return unreachableResult(currentUrl, 'Endereço não público ou inválido');
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      // Se tentou https:// e falhou na conexão, tenta http:// uma vez quando o usuário salvou sem protocolo
      if (
        hop === 0 &&
        !/^https?:\/\//i.test(rawUrl.trim()) &&
        currentUrl.startsWith('https://')
      ) {
        currentUrl = `http://${currentUrl.slice('https://'.length)}`;
        continue;
      }
      const msg =
        err instanceof Error && err.name === 'AbortError'
          ? 'Tempo esgotado (timeout)'
          : 'Não foi possível conectar ao site';
      return unreachableResult(currentUrl, msg, null, Date.now() - started);
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!loc) {
        return unreachableResult(
          currentUrl,
          `Redirecionamento sem destino (${res.status})`,
          res.status,
          Date.now() - started
        );
      }
      try {
        currentUrl = new URL(loc, currentUrl).toString();
      } catch {
        return unreachableResult(currentUrl, 'Redirecionamento inválido', res.status);
      }
      continue;
    }

    try {
      const responseMs = Date.now() - started;
      if (res.status >= 400) {
        await res.body?.cancel().catch(() => undefined);
        return unreachableResult(
          currentUrl,
          `HTTP ${res.status}`,
          res.status,
          responseMs
        );
      }
      const html = await readBoundedText(res, MAX_BYTES);
      return parseSiteHtml(html, {
        finalUrl: currentUrl,
        statusCode: res.status,
        responseMs,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return unreachableResult(
    currentUrl,
    'Muitos redirecionamentos',
    null,
    Date.now() - started
  );
}

export interface SiteAuditSummary {
  audited: number;
  noWebsite: number;
  unreachable: number;
  withoutPixel: number;
}

export async function auditLeadsWebsites(opts: {
  supabase: SupabaseClient;
  accountId: string;
  ids: string[];
  force?: boolean;
}): Promise<SiteAuditSummary> {
  const { supabase, accountId, ids, force = false } = opts;
  const { data: rows, error } = await supabase
    .from('prospect_leads')
    .select('id, website, site_checked_at')
    .eq('account_id', accountId)
    .in('id', ids);

  if (error) {
    throw new ProspectError('Não foi possível ler os leads para analisar os sites.', 500);
  }

  const list = (rows ?? []) as Pick<
    LeadRow,
    'id' | 'website' | 'site_checked_at'
  >[];

  const summary: SiteAuditSummary = {
    audited: 0,
    noWebsite: 0,
    unreachable: 0,
    withoutPixel: 0,
  };

  const targets = list.filter((l) => {
    if (!l.website?.trim()) {
      summary.noWebsite++;
      return false;
    }
    if (!force && l.site_checked_at) return false;
    return true;
  });

  const CONCURRENCY = 5;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const slice = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (lead) => {
        const result = await auditWebsite(lead.website!);
        const { error: upErr } = await supabase
          .from('prospect_leads')
          .update({
            site_data: result,
            site_checked_at: new Date().toISOString(),
          })
          .eq('account_id', accountId)
          .eq('id', lead.id);
        if (!upErr) {
          summary.audited++;
          if (!result.reachable) summary.unreachable++;
          else if (!hasAnyAdPixel(result.pixels)) summary.withoutPixel++;
        }
      })
    );
  }

  return summary;
}
