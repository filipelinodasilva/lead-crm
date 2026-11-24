import { describe, expect, it, vi } from 'vitest';

import { buildLeadsCsv, csvCell } from './csv';
import { applyLeadFilters, parseLeadFilters } from './filters';
import {
  createGoogleProvider,
  normalizeGooglePlace,
  type GooglePlace,
} from './google';
import { generateMockPlaces } from './mock';
import { parsePlacePhone } from './phone';
import { parseIds, parseSearchInput } from './service';
import { ProviderError, type LeadRow } from './types';
import {
  SIGNATURE_HEADER,
  allowedPrivateHosts,
  chunk,
  deliverLeadBatches,
  normalizeProspectWebhookUrl,
} from './webhook';
import { verifySignatureHeader } from '@/lib/webhooks/sign';

const lead = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  account_id: 'acc',
  search_id: null,
  provider: 'google',
  place_id: 'p1',
  name: 'Clínica Teste',
  category: 'dentist',
  address: 'Rua A, 1',
  city: 'Belo Horizonte',
  state: 'MG',
  lat: null,
  lng: null,
  phone: '(31) 99999-9999',
  phone_e164: '+5531999999999',
  phone_kind: 'mobile',
  website: null,
  rating: 4.8,
  review_count: 120,
  business_status: 'OPERATIONAL',
  maps_url: null,
  status: 'new',
  contact_id: null,
  webhook_sent_at: null,
  collected_at: '2026-10-25T00:00:00Z',
  created_at: '2026-10-25T00:00:00Z',
  ...over,
});

describe('parsePlacePhone', () => {
  it('classifies Brazilian mobile, landline and legacy numbers', () => {
    expect(parsePlacePhone('+55 31 99999-9999')).toEqual({
      e164: '+5531999999999',
      kind: 'mobile',
    });
    expect(parsePlacePhone('+55 31 3333-4444')).toEqual({
      e164: '+553133334444',
      kind: 'landline',
    });
    expect(parsePlacePhone('+55 11 8888-7777').kind).toBe('mobile');
  });
  it('keeps foreign numbers as unknown and drops junk', () => {
    expect(parsePlacePhone('+1 415-555-0123')).toEqual({
      e164: '+14155550123',
      kind: 'unknown',
    });
    expect(parsePlacePhone('123')).toEqual({ e164: null, kind: 'unknown' });
    expect(parsePlacePhone(null)).toEqual({ e164: null, kind: 'unknown' });
  });
});

describe('normalizeGooglePlace', () => {
  const place: GooglePlace = {
    id: 'ChIJ1',
    displayName: { text: ' Sorriso Bela ' },
    primaryType: 'dentist',
    formattedAddress: 'Rua X, 10 - Centro, Belo Horizonte - MG',
    addressComponents: [
      {
        longText: 'Belo Horizonte',
        types: ['administrative_area_level_2', 'political'],
      },
      {
        longText: 'Minas Gerais',
        shortText: 'MG',
        types: ['administrative_area_level_1'],
      },
    ],
    nationalPhoneNumber: '(31) 99999-9999',
    internationalPhoneNumber: '+55 31 99999-9999',
    rating: 4.7,
    userRatingCount: 88,
  };
  it('maps fields, city/state and phone kind', () => {
    const n = normalizeGooglePlace(place)!;
    expect(n).toMatchObject({
      placeId: 'ChIJ1',
      name: 'Sorriso Bela',
      category: 'dentist',
      city: 'Belo Horizonte',
      state: 'MG',
      phoneE164: '+5531999999999',
      phoneKind: 'mobile',
      website: null,
      reviewCount: 88,
    });
  });
  it('skips places without id or name', () => {
    expect(normalizeGooglePlace({ displayName: { text: 'x' } })).toBeNull();
    expect(normalizeGooglePlace({ id: 'a' })).toBeNull();
  });
});

describe('createGoogleProvider', () => {
  const page = (n: number, next?: string) =>
    new Response(
      JSON.stringify({
        places: Array.from({ length: n }, (_, i) => ({
          id: `id${next ?? 'last'}${i}`,
          displayName: { text: `N${i}` },
        })),
        nextPageToken: next,
      }),
      { status: 200 }
    );

  it('follows pages up to the wanted size and counts billable requests', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page(20, 'a'))
      .mockResolvedValueOnce(page(20, 'b'))
      .mockResolvedValueOnce(page(20));
    const out = await createGoogleProvider(
      'KEY',
      fetchImpl as unknown as typeof fetch
    ).search({ query: 'dentista', location: 'BH', maxResults: 60 }, 100);
    expect(out.places).toHaveLength(60);
    expect(out.requests).toBe(3);
    const first = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string
    );
    expect(first.textQuery).toBe('dentista em BH');
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toContain('places.userRatingCount');
  });

  it('never spends more than the budget', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page(20, 'a'));
    const out = await createGoogleProvider(
      'KEY',
      fetchImpl as unknown as typeof fetch
    ).search({ query: 'x', location: 'y', maxResults: 60 }, 1);
    expect(out.requests).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns partial results with a warning when a later page fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page(20, 'a'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'boom' } }), {
          status: 500,
        })
      );
    const out = await createGoogleProvider(
      'KEY',
      fetchImpl as unknown as typeof fetch
    ).search({ query: 'x', location: 'y', maxResults: 40 }, 10);
    expect(out.places).toHaveLength(20);
    expect(out.warning).toBe('boom');
  });

  it('throws when the first request fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'API key not valid' } }),
          { status: 400 }
        )
      );
    await expect(
      createGoogleProvider('BAD', fetchImpl as unknown as typeof fetch).search(
        { query: 'x', location: 'y', maxResults: 20 },
        10
      )
    ).rejects.toThrow(ProviderError);
  });
});

describe('generateMockPlaces', () => {
  it('is deterministic and safe (area code 00, marked as test)', () => {
    const a = generateMockPlaces({
      query: 'dentista',
      location: 'Belo Horizonte, MG',
      maxResults: 30,
    });
    const b = generateMockPlaces({
      query: 'dentista',
      location: 'Belo Horizonte, MG',
      maxResults: 30,
    });
    expect(a).toEqual(b);
    expect(a).toHaveLength(30);
    expect(new Set(a.map((p) => p.placeId)).size).toBe(30);
    for (const p of a) {
      expect(p.name).toContain('(teste)');
      expect(p.phoneE164).toMatch(/^\+5500/);
    }
  });
  it('mixes sites, mobile and landline so the filters have something to filter', () => {
    const a = generateMockPlaces({
      query: 'academia',
      location: 'Contagem, MG',
      maxResults: 60,
    });
    expect(a.some((p) => p.website)).toBe(true);
    expect(a.some((p) => !p.website)).toBe(true);
    expect(a.some((p) => p.phoneKind === 'mobile')).toBe(true);
    expect(a.some((p) => p.phoneKind === 'landline')).toBe(true);
  });
});

describe('csv', () => {
  it('neutralizes spreadsheet formulas and quotes separators', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+55 31')).toBe("'+55 31");
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(4.5)).toBe('4.5');
  });
  it('writes a BOM, a header and one line per lead', () => {
    const csv = buildLeadsCsv([
      lead(),
      lead({ name: '=cmd', website: 'https://x.com' }),
    ]);
    expect(csv.startsWith('﻿Nome;')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(';não;');
    expect(lines[2].startsWith("'=cmd;")).toBe(true);
  });
});

describe('lead filters', () => {
  it('validates untrusted input', () => {
    const f = parseLeadFilters(
      new URLSearchParams(
        'q=denti&category=dentist&website=without&minReviews=30&minRating=9&mobileOnly=1&status=bogus&searchId=nope'
      )
    );
    expect(f).toEqual({
      q: 'denti',
      category: 'dentist',
      website: 'without',
      minReviews: 30,
      minRating: 5,
      mobileOnly: true,
    });
    expect(parseLeadFilters(null)).toEqual({});
  });

  it('builds the query: hides discarded by default and escapes the text search', () => {
    const calls: [string, ...unknown[]][] = [];
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get:
          (_t, name: string) =>
          (...args: unknown[]) => {
            calls.push([name, ...args]);
            return builder;
          },
      }
    );
    applyLeadFilters(
      builder,
      parseLeadFilters({ q: 'a,b%(c)', website: 'with', minReviews: 10 })
    );
    expect(calls).toContainEqual(['not', 'website', 'is', null]);
    expect(calls).toContainEqual(['gte', 'review_count', 10]);
    expect(calls).toContainEqual(['neq', 'status', 'discarded']);
    const or = calls.find((c) => c[0] === 'or')![1] as string;
    expect(or).toBe('name.ilike.%a b  c%,address.ilike.%a b  c%');
  });

  it('status "all" shows everything', () => {
    const calls: string[] = [];
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, name: string) => () => {
          calls.push(name);
          return builder;
        },
      }
    );
    applyLeadFilters(builder, { status: 'all' });
    expect(calls).toEqual([]);
  });
});

describe('webhook', () => {
  it('chunks lists', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('accepts only https, or http on the operator allow-list, and never internal hosts', async () => {
    expect(
      await normalizeProspectWebhookUrl('http://example.com/hook', [])
    ).toBeNull();
    expect(
      await normalizeProspectWebhookUrl('https://127.0.0.1/hook', [])
    ).toBeNull();
    expect(
      await normalizeProspectWebhookUrl('https://localhost/hook', [])
    ).toBeNull();
    expect(
      await normalizeProspectWebhookUrl('https://user:pw@8.8.8.8/hook', [])
    ).toBeNull();
    expect(await normalizeProspectWebhookUrl('ftp://8.8.8.8/x', [])).toBeNull();
    expect(await normalizeProspectWebhookUrl('https://8.8.8.8/hook', [])).toBe(
      'https://8.8.8.8/hook'
    );
    expect(
      await normalizeProspectWebhookUrl('http://n8n.local:5678/webhook/x', [
        'n8n.local',
      ])
    ).toBe('http://n8n.local:5678/webhook/x');
    expect(
      allowedPrivateHosts({
        PROSPECT_WEBHOOK_ALLOW_HOSTS: ' N8N.local , host.docker.internal ',
      })
    ).toEqual(['n8n.local', 'host.docker.internal']);
  });

  it('signs each batch and reports which leads were delivered', async () => {
    const leads = Array.from({ length: 120 }, (_, i) =>
      lead({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })
    );
    const seen: { body: string; sig: string }[] = [];
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      seen.push({
        body: init.body as string,
        sig: (init.headers as Record<string, string>)[SIGNATURE_HEADER],
      });
      return new Response('ok', { status: seen.length === 2 ? 500 : 200 });
    });
    const out = await deliverLeadBatches({
      url: 'https://8.8.8.8/hook',
      secret: 's3cret',
      leads,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowSeconds: () => 1000,
    });
    expect(seen).toHaveLength(3);
    expect(out.delivered).toHaveLength(70);
    expect(out.failed).toEqual([
      { ids: leads.slice(50, 100).map((l) => l.id), error: 'HTTP 500' },
    ]);
    for (const s of seen)
      expect(verifySignatureHeader(s.sig, s.body, 's3cret', 1000)).toBe(true);
    expect(JSON.parse(seen[0].body)).toMatchObject({
      event: 'prospect.leads',
      batch: 1,
      batches: 3,
      count: 50,
    });
    expect(JSON.parse(seen[0].body).leads[0]).toMatchObject({
      has_website: false,
      phone_e164: '+5531999999999',
    });
  });
});

describe('input parsing', () => {
  it('validates the search form', () => {
    expect(
      parseSearchInput({ query: ' dentista ', location: 'BH', maxResults: 999 })
    ).toEqual({
      query: 'dentista',
      location: 'BH',
      maxResults: 60,
    });
    expect(parseSearchInput({ query: 'ab', location: 'BH' }).maxResults).toBe(
      20
    );
    expect(() => parseSearchInput({ query: 'x', location: 'BH' })).toThrow();
    expect(() =>
      parseSearchInput({ query: 'dentista', location: '' })
    ).toThrow();
  });

  it('validates id lists', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseIds([id, id, 'bad'])).toEqual([id]);
    expect(() => parseIds([])).toThrow();
    expect(() => parseIds('x')).toThrow();
    expect(() =>
      parseIds(
        Array.from(
          { length: 5 },
          (_, i) => `00000000-0000-4000-8000-00000000000${i}`
        ),
        3
      )
    ).toThrow();
  });
});
