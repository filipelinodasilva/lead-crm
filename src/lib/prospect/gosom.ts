// Motor gratuito: gosom/google-maps-scraper em modo servidor (API REST).
// Coletor gratuito do Google Maps (gosom). O endereço
// vem só do ambiente (PROSPECT_GOSOM_URL). Cada chamada tem prazo.

import { parsePlacePhone } from './phone';
import {
  ProviderError,
  type PlaceResult,
  type PlacesProvider,
  type SearchOutcome,
  type SearchParams,
} from './types';

type FetchLike = typeof fetch;
type JobStatus = 'pending' | 'working' | 'ok' | 'failed' | 'unknown';

const STATUS: Record<string, JobStatus> = {
  pending: 'pending',
  working: 'working',
  ok: 'ok',
  failed: 'failed',
};

/** Páginas de 20 resultados por busca, de 1 a 10. */
export const depthFor = (maxResults: number) =>
  Math.min(10, Math.max(1, Math.ceil(maxResults / 20)));

// ---------- CSV (RFC 4180), sem dependências ----------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  return rows;
}

const text = (v: string | undefined) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};
const num = (v: string | undefined) => {
  const n = Number((v ?? '').replace(',', '.'));
  return v && Number.isFinite(n) ? n : null;
};

/** "Rua X, 12 - Bairro, Ipatinga - MG, 35160-000, Brazil" -> cidade e UF. */
export function cityStateFromAddress(address: string | null): {
  city: string | null;
  state: string | null;
} {
  if (!address) return { city: null, state: null };
  const m = address.match(/,\s*([^,]+?)\s*-\s*([A-Z]{2})\b/);
  return m ? { city: m[1].trim(), state: m[2] } : { city: null, state: null };
}

/** Telefone do gosom vem nacional ("(31) 3822-1234"); o app guarda E.164. */
function phoneOf(raw: string | null) {
  if (!raw) return { phone: null, e164: null, kind: 'unknown' as const };
  const digits = raw.replace(/\D/g, '');
  const international =
    raw.trim().startsWith('+') || digits.length > 11 ? `+${digits}` : `+55${digits}`;
  const parsed = parsePlacePhone(international);
  return { phone: raw, e164: parsed.e164, kind: parsed.kind };
}

/** O gosom grafa "longtitude" (com erro) e às vezes "web_site"; aceitamos as duas. */
export function placesFromCsv(csv: string): PlaceResult[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) =>
    names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const idx = {
    placeId: col('place_id'),
    title: col('title'),
    category: col('category'),
    address: col('address'),
    phone: col('phone'),
    website: col('website', 'web_site'),
    rating: col('review_rating'),
    reviews: col('review_count'),
    lat: col('latitude'),
    lng: col('longitude', 'longtitude'),
    link: col('link'),
  };
  const get = (row: string[], i: number) => (i >= 0 ? row[i] : undefined);
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const row of rows.slice(1)) {
    const placeId = text(get(row, idx.placeId));
    const name = text(get(row, idx.title));
    if (!placeId || !name || seen.has(placeId)) continue;
    seen.add(placeId);
    const address = text(get(row, idx.address));
    const { city, state } = cityStateFromAddress(address);
    const phone = phoneOf(text(get(row, idx.phone)));
    out.push({
      placeId,
      name,
      category: text(get(row, idx.category)),
      address,
      city,
      state,
      lat: num(get(row, idx.lat)),
      lng: num(get(row, idx.lng)),
      phone: phone.phone,
      phoneE164: phone.e164,
      phoneKind: phone.kind,
      website: text(get(row, idx.website)),
      rating: num(get(row, idx.rating)),
      reviewCount: Math.round(num(get(row, idx.reviews)) ?? 0),
      businessStatus: null,
      mapsUrl: text(get(row, idx.link)),
    });
  }
  return out;
}

// ---------- cliente HTTP ----------

export class GosomClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  private async call(path: string, init: RequestInit = {}, timeoutMs = 20_000) {
    try {
      return await this.fetchImpl(`${this.base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ProviderError(
        'Não foi possível falar com o coletor de empresas (ele pode estar desligado).'
      );
    }
  }

  async createJob(input: {
    name: string;
    keyword: string;
    depth: number;
    maxTimeSec: number;
  }): Promise<string> {
    const res = await this.call('/api/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        keywords: [input.keyword],
        lang: 'pt',
        zoom: 15,
        depth: input.depth,
        email: false,
        fast_mode: false,
        max_time: input.maxTimeSec,
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      id?: string;
      message?: string;
    } | null;
    if (!res.ok || !json?.id) {
      throw new ProviderError(
        `O coletor recusou a busca${json?.message ? `: ${json.message}` : '.'}`
      );
    }
    return json.id;
  }

  async jobStatus(id: string): Promise<JobStatus> {
    const res = await this.call(`/api/v1/jobs/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      throw new ProviderError('O coletor perdeu a busca (foi reiniciado?).');
    }
    // A API devolve os campos com inicial maiúscula (Status); aceitamos as duas formas.
    const json = (await res.json().catch(() => null)) as {
      Status?: string;
      status?: string;
    } | null;
    return (
      STATUS[String(json?.Status ?? json?.status ?? '').toLowerCase()] ??
      'unknown'
    );
  }

  async downloadCsv(id: string): Promise<string> {
    const res = await this.call(
      `/api/v1/jobs/${encodeURIComponent(id)}/download`,
      {},
      60_000
    );
    if (!res.ok) {
      throw new ProviderError('O coletor não entregou o arquivo de resultados.');
    }
    return await res.text();
  }

  async deleteJob(id: string): Promise<void> {
    await this.call(
      `/api/v1/jobs/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      10_000
    ).catch(() => undefined);
  }
}

// ---------- provedor ----------

export interface GosomOptions {
  /** Prazo total de uma busca, em segundos. */
  timeoutSec?: number;
  /** Intervalo entre consultas ao estado do job, em ms. */
  pollMs?: number;
  fetchImpl?: FetchLike;
}

export function createGosomProvider(
  baseUrl: string,
  options: GosomOptions = {}
): PlacesProvider {
  const timeoutSec = options.timeoutSec ?? 300;
  const pollMs = options.pollMs ?? 3000;
  const client = new GosomClient(baseUrl, options.fetchImpl);

  return {
    id: 'gosom',
    async search(
      params: SearchParams,
      requestBudget: number
    ): Promise<SearchOutcome> {
      if (requestBudget < 1) {
        throw new ProviderError('O limite de buscas do mês acabou.', 400);
      }
      const id = await client.createJob({
        name: `cp-${Date.now()}`,
        keyword: `${params.query} em ${params.location}`,
        depth: depthFor(params.maxResults),
        maxTimeSec: timeoutSec,
      });
      try {
        const deadline = Date.now() + (timeoutSec + 30) * 1000;
        for (;;) {
          const status = await client.jobStatus(id);
          if (status === 'ok') break;
          if (status === 'failed') {
            throw new ProviderError('O coletor não conseguiu fazer esta busca.');
          }
          if (Date.now() > deadline) {
            throw new ProviderError(
              'A busca demorou mais que o prazo. Tente de novo com menos empresas.'
            );
          }
          await new Promise((r) => setTimeout(r, pollMs));
        }
        const places = placesFromCsv(await client.downloadCsv(id)).slice(
          0,
          params.maxResults
        );
        return { places, requests: 1 };
      } finally {
        await client.deleteJob(id);
      }
    },
  };
}
