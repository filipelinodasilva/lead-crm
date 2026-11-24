import { describe, expect, it } from 'vitest';

import {
  hasAnyAdPixel,
  normalizeWebsiteUrl,
  parseSiteHtml,
} from './site-audit';

describe('site-audit parser (Fase 3)', () => {
  it('normalizes URLs and rejects invalid protocols', () => {
    expect(normalizeWebsiteUrl('clinicaexemplo.com.br')).toBe(
      'https://clinicaexemplo.com.br/'
    );
    expect(normalizeWebsiteUrl('http://a.com/x')).toBe('http://a.com/x');
    expect(normalizeWebsiteUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeWebsiteUrl('')).toBeNull();
  });

  it('extracts pixels, WhatsApp, socials, emails, SEO tags and WordPress CMS', () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Clínica Sorriso — Odontologia em Ipatinga</title>
          <meta name="description" content="Tratamentos odontológicos completos em Ipatinga MG com hora marcada." />
          <link rel="stylesheet" href="/wp-content/themes/sorriso/style.css" />
          <script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"></script>
          <script>fbq('init', '1234567890');</script>
        </head>
        <body>
          <h1>Clínica Sorriso</h1>
          <a href="https://wa.me/5531988887777">Agendar pelo WhatsApp</a>
          <a href="https://www.instagram.com/clinicasorriso/">Instagram</a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=x">Compartilhar</a>
          <a href="https://www.facebook.com/clinicasorrisooficial">Facebook</a>
          <a href="mailto:contato@clinicasorriso.com.br">contato@clinicasorriso.com.br</a>
          <img src="banner@2x.png" />
        </body>
      </html>
    `;
    const r = parseSiteHtml(html, {
      finalUrl: 'https://clinicasorriso.com.br/',
      statusCode: 200,
      responseMs: 320,
    });
    expect(r.reachable).toBe(true);
    expect(r.https).toBe(true);
    expect(r.cms).toBe('WordPress');
    expect(r.has_h1).toBe(true);
    expect(r.has_meta_description).toBe(true);
    expect(r.pixels).toEqual({
      meta: true,
      gtm: true,
      ga_ads: false,
      tiktok: false,
    });
    expect(hasAnyAdPixel(r.pixels)).toBe(true);
    expect(r.has_whatsapp).toBe(true);
    expect(r.whatsapp_links).toEqual(['https://wa.me/5531988887777']);
    expect(r.emails).toEqual(['contato@clinicasorriso.com.br']);
    expect(r.socials.instagram).toBe('https://www.instagram.com/clinicasorriso');
    expect(r.socials.facebook).toBe(
      'https://www.facebook.com/clinicasorrisooficial'
    );
  });

  it('flags sites with zero ad pixels accurately', () => {
    const r = parseSiteHtml('<html><body>Olá</body></html>', {
      finalUrl: 'http://simples.com.br/',
      statusCode: 200,
      responseMs: 150,
    });
    expect(r.https).toBe(false);
    expect(hasAnyAdPixel(r.pixels)).toBe(false);
    expect(r.has_whatsapp).toBe(false);
  });
});
