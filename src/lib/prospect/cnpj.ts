// Funções puras da Fase 2: normalização e decisão de casamento Maps -> CNPJ,
// além de formatação segura para tela e CSV (suporta CNPJ numérico e alfanumérico).

import type {
  CnpjCandidate,
  CnpjData,
  CnpjMatchMethod,
  CnpjMatchStatus,
} from './types';

export const LIMIAR_NOME = 0.5;
export const LIMIAR_FORTE = 0.75;

/** Remove acentos para comparar com `rf_nome_norm` do banco. */
export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Mantém apenas os 14 caracteres alfanuméricos do CNPJ em maiúsculas. */
export function cleanCnpj(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /^[0-9A-Z]{12}\d{2}$/.test(cleaned) ? cleaned : null;
}

/** 12345678000195 -> 12.345.678/0001-95 */
export function formatCnpj(raw: string | null | undefined): string {
  const c = cleanCnpj(raw);
  if (!c) return raw ?? '';
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12, 14)}`;
}

/** Rótulo legível do porte na Receita Federal. */
export function porteLabel(
  data: Pick<CnpjData, 'porte' | 'mei'> | null | undefined
): string {
  if (!data) return '';
  if (data.mei) return 'MEI';
  if (data.porte === 1) return 'ME';
  if (data.porte === 3) return 'EPP';
  if (data.porte === 5) return 'Médio/Grande';
  return '';
}

/** Variações DDD+número sem 55 e sem zero inicial (com e sem o 9 de celular). */
export function phoneVariants(raw: string | null | undefined): string[] {
  let d = (raw ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) {
    d = d.slice(2);
  }
  d = d.replace(/^0+/, '');
  if (d.length !== 10 && d.length !== 11) return [];
  const out = new Set<string>([d]);
  if (d.length === 11 && d[2] === '9') {
    out.add(d.slice(0, 2) + d.slice(3));
  }
  if (d.length === 10 && '6789'.includes(d[2])) {
    out.add(d.slice(0, 2) + '9' + d.slice(2));
  }
  return [...out].sort();
}

/** Extrai o CEP de 8 dígitos de um endereço formatado do Google Maps. */
export function extractCep(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = address.match(/\b(\d{5})-?(\d{3})\b/);
  return m ? m[1] + m[2] : null;
}

/** Extrai o número predial logo após a primeira vírgula do logradouro. */
export function extractStreetNumber(
  address: string | null | undefined
): string | null {
  if (!address) return null;
  const m = address.match(/,\s*(\d{1,6})\b/);
  return m ? m[1] : null;
}

/** Extrai cidade e UF de endereços no formato ", Ipatinga - MG". */
export function extractCityState(address: string | null | undefined): {
  city: string | null;
  state: string | null;
} {
  if (!address) return { city: null, state: null };
  const m = address.match(/,\s*([^,]+?)\s*-\s*([A-Z]{2})\b/);
  return m ? { city: m[1].trim(), state: m[2] } : { city: null, state: null };
}

/** Tenta extrair o bairro em endereços brasileiros ("Rua X, 123 - Centro, Cidade - UF"). */
export function extractNeighborhood(
  address: string | null | undefined
): string | null {
  if (!address) return null;
  const m = address.match(/,\s*\d{1,6}(?:\s*-\s*[^,-]+)?\s*-\s*([^,]+),\s*[^,]+?\s*-\s*[A-Z]{2}\b/);
  return m ? m[1].trim() : null;
}

/**
 * Gera variações limpas do nome do Maps (nome inteiro e primeira parte antes de | - – ( :),
 * removendo acentos, nome da cidade e bairro para evitar falsos positivos de localização.
 */
export function candidateNames(
  name: string | null | undefined,
  city?: string | null,
  neighborhood?: string | null
): string[] {
  const src = name ?? '';
  const head = src.split(/\s[|\-–:]\s|[|(:]/)[0] ?? '';
  let parts = [src, head].map(stripAccents);
  for (const drop of [city, neighborhood]) {
    if (drop && drop.trim().length >= 3) {
      const escaped = stripAccents(drop.trim()).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );
      const re = new RegExp(escaped, 'gi');
      parts = parts.map((p) => p.replace(re, ' '));
    }
  }
  const uniq = new Set(
    parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length >= 3)
  );
  return [...uniq].sort();
}

export interface CandidateDecision {
  status: CnpjMatchStatus;
  method: CnpjMatchMethod;
  top: CnpjCandidate | null;
}

/**
 * Aplica a regra calibrada da Fase 2 v3 sobre os candidatos de `rf.casamento`:
 * - `address`: mesmo CEP+número e semelhança de nome >= 0.5
 * - `name`: semelhança >= 0.75 (ou >= 0.5 com mesmo CEP)
 * - `review`: há candidato na cidade/endereço, mas exige revisão humana (ex.: prédio comercial, MEI no CPF/nome civil, franquia sem CEP igual)
 * - `none`: lista vazia
 */
export function decideCandidate(rows: CnpjCandidate[]): CandidateDecision {
  if (!rows.length) {
    return { status: 'none', method: 'none', top: null };
  }
  const atAddress = rows.filter((r) => r.mesmo_endereco);
  const bestOverall = rows.reduce((best, cur) =>
    cur.sim > best.sim ? cur : best
  );

  if (atAddress.length > 0) {
    const bestAtAddress = atAddress.reduce((best, cur) =>
      cur.sim > best.sim ? cur : best
    );
    if (bestAtAddress.sim >= LIMIAR_NOME) {
      return { status: 'matched', method: 'address', top: bestAtAddress };
    }
    if (atAddress.length === 1 && bestAtAddress.sim >= bestOverall.sim) {
      return { status: 'review', method: 'review', top: bestAtAddress };
    }
  }

  if (
    bestOverall.sim >= LIMIAR_FORTE ||
    (bestOverall.sim >= LIMIAR_NOME && bestOverall.mesmo_cep)
  ) {
    return { status: 'matched', method: 'name', top: bestOverall };
  }

  return { status: 'review', method: 'review', top: bestOverall };
}
