// Fase 3 (puro, cliente + servidor): análise de HTML do site do lead para extrair
// pixels de anúncio (Meta, GTM, Google Ads/GA4, TikTok), links de WhatsApp,
// redes sociais, e-mails públicos e plataforma/CMS.

import type { SiteAuditData, SiteAuditPixels } from './types';

const IGNORED_EMAIL_DOMAINS = new Set([
  'sentry.io',
  'sentry-next.wixpress.com',
  'wixpress.com',
  'example.com',
  'domain.com',
  'seuemail.com',
  'email.com',
  'u003e',
]);

const ASSET_EXT = /\.(png|jpe?g|webp|gif|svg|ico|css|js|woff2?|ttf|eot|mp4)$/i;

export function hasAnyAdPixel(
  pixels: SiteAuditPixels | null | undefined
): boolean {
  if (!pixels) return false;
  return Boolean(pixels.meta || pixels.gtm || pixels.ga_ads || pixels.tiktok);
}

export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function cleanEmail(candidate: string): string | null {
  const e = decodeURIComponent(candidate)
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '')
    .split('?')[0]
    .replace(/[.,;:)>\]"']+$/, '');
  if (!/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,12}$/.test(e)) return null;
  if (ASSET_EXT.test(e)) return null;
  const domain = e.split('@')[1] ?? '';
  if (IGNORED_EMAIL_DOMAINS.has(domain)) return null;
  for (const bad of IGNORED_EMAIL_DOMAINS) {
    if (domain.endsWith(`.${bad}`)) return null;
  }
  return e;
}

function detectCms(html: string): string | null {
  if (/\/wp-content\/|\/wp-includes\//i.test(html)) return 'WordPress';
  if (/wixstatic\.com|wix\.com/i.test(html)) return 'Wix';
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) return 'Shopify';
  if (/squarespace\.com/i.test(html)) return 'Squarespace';
  if (/webflow\.com/i.test(html)) return 'Webflow';
  if (/rdstation\.com|d335luupugsy2\.cloudfront\.net/i.test(html))
    return 'RD Station';
  if (/GREATPAGES|greatpages/i.test(html)) return 'GreatPages';
  if (/_next\/static/i.test(html)) return 'Next.js';
  return null;
}

function firstSocialMatch(html: string, pattern: RegExp, invalidPaths: RegExp): string | null {
  for (const m of html.matchAll(pattern)) {
    const full = m[0].replace(/["'<>)\s]+$/, '').replace(/\/+$/, '');
    const path = (m[1] ?? '').replace(/\/+$/, '');
    if (!path || invalidPaths.test(path)) continue;
    return full.startsWith('http') ? full : `https://${full}`;
  }
  return null;
}

export function parseSiteHtml(
  html: string,
  meta: {
    finalUrl: string;
    statusCode: number;
    responseMs: number;
  }
): SiteAuditData {
  const src = html.slice(0, 600_000);

  const titleMatch = src.match(/<title[^>]*>([\s\S]{1,250}?)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 160) || null
    : null;

  const has_meta_description =
    /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}/i.test(src) ||
    /<meta[^>]+content=["'][^"']{10,}["'][^>]+name=["']description["']/i.test(src);

  const has_h1 = /<h1[\s>]/i.test(src);

  const pixels: SiteAuditPixels = {
    meta:
      /connect\.facebook\.net|fbevents\.js|fbq\s*\(\s*['"]init['"]|facebook\.com\/tr\?id=/i.test(
        src
      ),
    gtm: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{5,10}/.test(src),
    ga_ads:
      /googletagmanager\.com\/gtag\/js|gtag\s*\(\s*['"]config['"]|\b(?:G-[A-Z0-9]{6,12}|AW-\d{7,12})\b/.test(
        src
      ),
    tiktok: /analytics\.tiktok\.com|ttq\.load\s*\(/i.test(src),
  };

  const waSet = new Set<string>();
  const waRe =
    /https?:\/\/(?:wa\.me\/|api\.whatsapp\.com\/send|web\.whatsapp\.com\/send)[^\s"'<>)]*/gi;
  for (const m of src.matchAll(waRe)) {
    waSet.add(m[0].slice(0, 180));
    if (waSet.size >= 4) break;
  }
  const has_whatsapp =
    waSet.size > 0 || /whatsapp:\/\/send|href=["'][^"']*whatsapp/i.test(src);

  const emailSet = new Set<string>();
  for (const m of src.matchAll(/mailto:([^\s"'<>?]+)/gi)) {
    const c = cleanEmail(m[1]);
    if (c) emailSet.add(c);
  }
  for (const m of src.matchAll(
    /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,12}\b/g
  )) {
    const c = cleanEmail(m[0]);
    if (c) emailSet.add(c);
    if (emailSet.size >= 5) break;
  }

  const instagram = firstSocialMatch(
    src,
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,40})\/?/gi,
    /^(?:p|reel|reels|stories|explore|accounts|about|legal|developer)$/i
  );
  const facebook = firstSocialMatch(
    src,
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([A-Za-z0-9._-]{2,60})\/?/gi,
    /^(?:tr|sharer|sharer\.php|share|dialog|plugins|groups|events|watch|privacy|policies)$/i
  );
  const linkedin = firstSocialMatch(
    src,
    /(?:https?:\/\/)?(?:[a-z]{2}\.)?(?:www\.)?linkedin\.com\/((?:company|in)\/[A-Za-z0-9._%-]{2,80})\/?/gi,
    /^share$/i
  );
  const youtube = firstSocialMatch(
    src,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/((?:@|channel\/|c\/)[A-Za-z0-9._%-]{2,80})\/?/gi,
    /^watch$/i
  );

  let https = false;
  try {
    https = new URL(meta.finalUrl).protocol === 'https:';
  } catch {
    https = meta.finalUrl.startsWith('https://');
  }

  return {
    reachable: meta.statusCode >= 200 && meta.statusCode < 400,
    status_code: meta.statusCode,
    https,
    response_ms: meta.responseMs,
    final_url: meta.finalUrl,
    title,
    has_meta_description,
    has_h1,
    has_whatsapp,
    whatsapp_links: [...waSet],
    pixels,
    emails: [...emailSet].slice(0, 4),
    socials: { instagram, facebook, linkedin, youtube },
    cms: detectCms(src),
    error: null,
  };
}
