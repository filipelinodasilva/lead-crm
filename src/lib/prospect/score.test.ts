import { describe, expect, it } from 'vitest';

import { scoreLead, tierOf } from './score';

const base = {
  website: null,
  review_count: 0,
  rating: null,
  phone_kind: 'unknown' as const,
  phone_e164: null as string | null,
};

describe('scoreLead', () => {
  it('rates a no-site, many-reviews, mobile business as hot', () => {
    const r = scoreLead({
      ...base,
      review_count: 252,
      rating: 5,
      phone_kind: 'mobile',
      phone_e164: '+5531999999999',
    });
    expect(r.score).toBe(98);
    expect(r.tier).toBe('hot');
    expect(r.reason).toContain('não tem site');
    expect(r.reason).toContain('252 avaliações');
  });

  it('gives less to a business that already has a site', () => {
    const withSite = scoreLead({
      ...base,
      website: 'https://x.com.br',
      review_count: 252,
      rating: 5,
      phone_kind: 'mobile',
      phone_e164: '+5531999999999',
    });
    expect(withSite.score).toBe(63);
    expect(withSite.tier).toBe('good');
  });

  it('caps the score at 40 when there is no phone', () => {
    const r = scoreLead({ ...base, review_count: 300, rating: 4.9 });
    expect(r.score).toBe(40);
    expect(r.tier).toBe('warm');
  });

  it('never goes above 100 and factors add up to the score when reachable', () => {
    const r = scoreLead({
      ...base,
      review_count: 999,
      rating: 5,
      phone_kind: 'mobile',
      phone_e164: '+5531999999999',
    });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.factors.reduce((s, f) => s + f.points, 0)).toBe(r.score);
  });

  it('boosts score when website has no ad pixels or is offline (Fase 3)', () => {
    const noPixel = scoreLead({
      ...base,
      website: 'https://x.com.br',
      review_count: 120,
      rating: 4.8,
      phone_kind: 'mobile',
      phone_e164: '+5531999999999',
      site_data: {
        reachable: true,
        status_code: 200,
        https: true,
        response_ms: 200,
        final_url: 'https://x.com.br/',
        title: 'Clínica X',
        has_meta_description: false,
        has_h1: true,
        has_whatsapp: false,
        whatsapp_links: [],
        pixels: { meta: false, gtm: false, ga_ads: false, tiktok: false },
        emails: [],
        socials: { instagram: null, facebook: null, linkedin: null, youtube: null },
        cms: 'WordPress',
      },
    });
    expect(noPixel.score).toBe(84);
    expect(noPixel.tier).toBe('hot');
    expect(noPixel.reason).toContain('site sem Pixel/GTM');
  });
});

describe('tierOf', () => {
  it('splits at 80 and 60', () => {
    expect(tierOf(80)).toBe('hot');
    expect(tierOf(79)).toBe('good');
    expect(tierOf(60)).toBe('good');
    expect(tierOf(59)).toBe('warm');
  });
});
