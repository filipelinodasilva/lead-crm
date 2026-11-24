// ============================================================
// Lead CRM — shared types for the prospecting module.
// ============================================================

export type PhoneKind = 'mobile' | 'landline' | 'unknown';
export type LeadStatus = 'new' | 'in_pipeline' | 'discarded';
export type ProviderId = 'google' | 'gosom' | 'mock';

/** A business as returned by a places provider, already normalized. */
export interface PlaceResult {
  placeId: string;
  name: string;
  /** Google `primaryType`, e.g. "dentist". */
  category: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  /** Phone as displayed, e.g. "(31) 99999-9999". */
  phone: string | null;
  phoneE164: string | null;
  phoneKind: PhoneKind;
  website: string | null;
  rating: number | null;
  reviewCount: number;
  businessStatus: string | null;
  mapsUrl: string | null;
}

export interface SearchParams {
  /** What to look for, e.g. "dentista". */
  query: string;
  /** Where, e.g. "Belo Horizonte, MG". */
  location: string;
  /** 1..60. Google returns 20 per page and at most 3 pages. */
  maxResults: number;
}

export interface SearchOutcome {
  places: PlaceResult[];
  /** Billable provider requests actually made. */
  requests: number;
  /** Set when a later page failed after earlier pages succeeded. */
  warning?: string;
}

export interface PlacesProvider {
  id: ProviderId;
  /**
   * `requestBudget` is how many billable requests the caller may still
   * spend this month; the provider must never exceed it.
   */
  search(params: SearchParams, requestBudget: number): Promise<SearchOutcome>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** A problem the user can read and act on (bad input, missing setup, failed write). */
export class ProspectError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 500 = 400
  ) {
    super(message);
    this.name = 'ProspectError';
  }
}

export class QuotaError extends Error {
  readonly status = 429 as const;
  constructor(message: string) {
    super(message);
    this.name = 'QuotaError';
  }
}

export type CnpjMatchStatus = 'matched' | 'review' | 'none';
export type CnpjMatchMethod =
  | 'phone'
  | 'address'
  | 'name'
  | 'review'
  | 'manual'
  | 'none';

export interface CnpjSocio {
  nome: string;
  qualificacao: string | null;
}

export interface CnpjCandidate {
  cnpj: string;
  nome: string;
  sim: number;
  mesmo_endereco: boolean;
  mesmo_cep: boolean;
}

export interface CnpjData {
  cnpj: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  porte: number | null;
  mei: boolean;
  simples: boolean;
  data_inicio: string | null;
  capital_social: number | null;
  cnae_principal: number | null;
  cnae_descricao: string | null;
  email: string | null;
  telefone1: string | null;
  telefone2: string | null;
  socios: CnpjSocio[];
  nota_casamento?: string | null;
  candidatos?: CnpjCandidate[];
}

export interface SiteAuditPixels {
  meta: boolean;
  gtm: boolean;
  ga_ads: boolean;
  tiktok: boolean;
}

export interface SiteAuditSocials {
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  youtube: string | null;
}

export interface SiteAuditData {
  reachable: boolean;
  status_code: number | null;
  https: boolean;
  response_ms: number | null;
  final_url: string | null;
  title: string | null;
  has_meta_description: boolean;
  has_h1: boolean;
  has_whatsapp: boolean;
  whatsapp_links: string[];
  pixels: SiteAuditPixels;
  emails: string[];
  socials: SiteAuditSocials;
  cms: string | null;
  error?: string | null;
}

/** Row shape of `prospect_leads` as the app reads it. */
export interface LeadRow {
  id: string;
  account_id: string;
  search_id: string | null;
  provider: string;
  place_id: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  phone_e164: string | null;
  phone_kind: PhoneKind;
  website: string | null;
  rating: number | null;
  review_count: number;
  business_status: string | null;
  maps_url: string | null;
  status: LeadStatus;
  contact_id: string | null;
  webhook_sent_at: string | null;
  cnpj?: string | null;
  cnpj_match_status?: CnpjMatchStatus | null;
  cnpj_match_method?: CnpjMatchMethod | null;
  cnpj_data?: CnpjData | null;
  cnpj_checked_at?: string | null;
  site_data?: SiteAuditData | null;
  site_checked_at?: string | null;
  collected_at: string;
  created_at: string;
}
