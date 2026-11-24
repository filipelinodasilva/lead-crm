import { describe, expect, it, vi } from 'vitest';

import {
  cityStateFromAddress,
  createGosomProvider,
  depthFor,
  parseCsv,
  placesFromCsv,
} from './gosom';

const CSV = [
  'title,category,address,phone,website,review_count,review_rating,latitude,longtitude,place_id,link',
  '"Clínica Sol, Centro",Dentista,"Rua A, 12 - Centro, Ipatinga - MG, 35160-000, Brazil",(31) 99732-3889,,252,4.9,-19.4,-42.5,P1,https://maps.google.com/?cid=1',
  'Odonto Vida,Clínica odontológica,"Av B, 5 - Cidade Nobre, Ipatinga - MG, Brazil",(31) 3821-8941,https://odontovida.com.br,10,4.2,-19.5,-42.6,P2,',
  'Duplicada,Dentista,,,,0,,,,P1,',
  'Sem id,Dentista,,,,0,,,,,',
].join('\n');

describe('parseCsv', () => {
  it('keeps commas and quotes inside quoted fields', () => {
    expect(parseCsv('a,"b,c","d ""e"""\n1,2,3')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('placesFromCsv', () => {
  const places = placesFromCsv(CSV);

  it('drops rows with no id and repeated ids', () => {
    expect(places.map((p) => p.placeId)).toEqual(['P1', 'P2']);
  });

  it('maps the fields the app stores', () => {
    const [a, b] = places;
    expect(a.name).toBe('Clínica Sol, Centro');
    expect(a.category).toBe('Dentista');
    expect(a.city).toBe('Ipatinga');
    expect(a.state).toBe('MG');
    expect(a.rating).toBe(4.9);
    expect(a.reviewCount).toBe(252);
    expect(a.website).toBeNull();
    expect(a.lng).toBe(-42.5); // o coletor grafa "longtitude"
    expect(b.website).toBe('https://odontovida.com.br');
    expect(b.mapsUrl).toBeNull();
  });

  it('turns national phones into E.164 and tells mobile from landline', () => {
    const [a, b] = places;
    expect(a.phone).toBe('(31) 99732-3889');
    expect(a.phoneE164).toBe('+5531997323889');
    expect(a.phoneKind).toBe('mobile');
    expect(b.phoneE164).toBe('+553138218941');
    expect(b.phoneKind).toBe('landline');
  });

  it('returns nothing for an empty file', () => {
    expect(placesFromCsv('')).toEqual([]);
    expect(placesFromCsv('title,place_id')).toEqual([]);
  });
});

describe('cityStateFromAddress', () => {
  it('reads city and state, and tolerates a missing address', () => {
    expect(
      cityStateFromAddress('Rua X, 1 - Bairro, Belo Horizonte - MG, 30000-000')
    ).toEqual({ city: 'Belo Horizonte', state: 'MG' });
    expect(cityStateFromAddress(null)).toEqual({ city: null, state: null });
    expect(cityStateFromAddress('sem formato')).toEqual({
      city: null,
      state: null,
    });
  });
});

describe('depthFor', () => {
  it('uses one page per 20 results, from 1 to 10', () => {
    expect(depthFor(1)).toBe(1);
    expect(depthFor(20)).toBe(1);
    expect(depthFor(21)).toBe(2);
    expect(depthFor(60)).toBe(3);
    expect(depthFor(9999)).toBe(10);
  });
});

function fakeGosom(statuses: string[], csv = CSV) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${u.replace('http://gosom', '')}`);
    if (method === 'POST') return Response.json({ id: 'job1' });
    if (method === 'DELETE') return new Response(null, { status: 200 });
    if (u.endsWith('/download')) return new Response(csv);
    return Response.json({ Status: statuses.shift() ?? 'ok' });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('createGosomProvider', () => {
  it('waits for the job, reads the file and always deletes the job', async () => {
    const { fetchImpl, calls } = fakeGosom(['pending', 'working', 'ok']);
    const provider = createGosomProvider('http://gosom', {
      pollMs: 1,
      fetchImpl,
    });
    const out = await provider.search(
      { query: 'dentista', location: 'Ipatinga, MG', maxResults: 20 },
      5
    );
    expect(provider.id).toBe('gosom');
    expect(out.requests).toBe(1);
    expect(out.places.map((p) => p.placeId)).toEqual(['P1', 'P2']);
    expect(calls[0]).toBe('POST /api/v1/jobs');
    expect(calls.at(-1)).toBe('DELETE /api/v1/jobs/job1');
    const body = JSON.parse(
      (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } })
        .mock.calls[0][1].body as string
    );
    expect(body.keywords).toEqual(['dentista em Ipatinga, MG']);
    expect(body.lang).toBe('pt');
  });

  it('cuts the list to the number asked', async () => {
    const { fetchImpl } = fakeGosom(['ok']);
    const out = await createGosomProvider('http://gosom', {
      pollMs: 1,
      fetchImpl,
    }).search({ query: 'x', location: 'y', maxResults: 1 }, 5);
    expect(out.places).toHaveLength(1);
  });

  it('fails clearly when the job fails, and still deletes it', async () => {
    const { fetchImpl, calls } = fakeGosom(['failed']);
    await expect(
      createGosomProvider('http://gosom', { pollMs: 1, fetchImpl }).search(
        { query: 'x', location: 'y', maxResults: 20 },
        5
      )
    ).rejects.toThrow(/não conseguiu/);
    expect(calls.at(-1)).toBe('DELETE /api/v1/jobs/job1');
  });

  it('refuses to start when the monthly budget is spent', async () => {
    const { fetchImpl, calls } = fakeGosom(['ok']);
    await expect(
      createGosomProvider('http://gosom', { fetchImpl }).search(
        { query: 'x', location: 'y', maxResults: 20 },
        0
      )
    ).rejects.toThrow(/limite/i);
    expect(calls).toHaveLength(0);
  });

  it('explains when the engine is off', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      createGosomProvider('http://gosom', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }).search({ query: 'x', location: 'y', maxResults: 20 }, 5)
    ).rejects.toThrow(/desligado/);
  });
});
