// Nota de oportunidade de um lead (0 a 100): quanto mais demanda comprovada
// (avaliações, porte/tempo de CNPJ) e menor maturidade digital (sem site, site fora do ar,
// sem Pixel/GTM ou sem WhatsApp no site), mais ele vale a sua próxima abordagem.

import { hasAnyAdPixel } from './site-audit';
import type { LeadRow } from './types';

export type ScoreTier = 'hot' | 'good' | 'warm';

export interface LeadScore {
  score: number;
  tier: ScoreTier;
  /** Frase curta em português que explica a nota. */
  reason: string;
  /** Cada fator com o ponto que somou, para a aba Score. */
  factors: { label: string; points: number }[];
}

type ScoreInput = Pick<
  LeadRow,
  'website' | 'review_count' | 'rating' | 'phone_kind' | 'phone_e164'
> &
  Partial<Pick<LeadRow, 'site_data' | 'cnpj_match_status' | 'cnpj_data'>>;

const BASE = 20;

function reviewPoints(n: number): number {
  if (n >= 200) return 25;
  if (n >= 100) return 20;
  if (n >= 50) return 14;
  if (n >= 20) return 8;
  return 0;
}

export function tierOf(score: number): ScoreTier {
  if (score >= 80) return 'hot';
  if (score >= 60) return 'good';
  return 'warm';
}

export function scoreLead(lead: ScoreInput): LeadScore {
  const factors: LeadScore['factors'] = [
    { label: 'Ponto de partida', points: BASE },
  ];

  const hasSite = Boolean(lead.website);
  const site = lead.site_data ?? null;

  if (!hasSite) {
    factors.push({ label: 'Não tem site', points: 35 });
  } else if (site) {
    if (!site.reachable) {
      factors.push({
        label: 'Site fora do ar (oportunidade urgente)',
        points: 25,
      });
    } else {
      if (!hasAnyAdPixel(site.pixels)) {
        factors.push({
          label: 'Site sem Pixel/GTM (não mede tráfego pago)',
          points: 18,
        });
      }
      if (!site.has_whatsapp) {
        factors.push({ label: 'Site sem botão de WhatsApp', points: 8 });
      }
      if (!site.https) {
        factors.push({ label: 'Site sem HTTPS (não seguro)', points: 6 });
      }
    }
  }

  const reviews = lead.review_count ?? 0;
  const rp = reviewPoints(reviews);
  if (rp > 0) {
    factors.push({
      label: `${reviews} avaliações (clientes não faltam)`,
      points: rp,
    });
  }

  if (lead.rating !== null && lead.rating >= 4) {
    factors.push({
      label: `Nota ${String(lead.rating).replace('.', ',')} (negócio de confiança)`,
      points: 8,
    });
  }

  if (lead.cnpj_match_status === 'matched' && lead.cnpj_data) {
    const porte = lead.cnpj_data.porte;
    const openedYear = lead.cnpj_data.data_inicio
      ? Number(lead.cnpj_data.data_inicio.slice(0, 4))
      : null;
    const olderThan2y =
      openedYear !== null &&
      Number.isFinite(openedYear) &&
      new Date().getFullYear() - openedYear >= 2;
    if (porte === 3 || porte === 5 || (olderThan2y && !lead.cnpj_data.mei)) {
      factors.push({
        label: 'Empresa consolidada na Receita (CNPJ ativo)',
        points: 6,
      });
    }
  }

  const reachable = Boolean(lead.phone_e164);
  if (reachable && lead.phone_kind === 'mobile') {
    factors.push({ label: 'Celular (dá para chamar no WhatsApp)', points: 10 });
  }

  const rawSum = factors.reduce((sum, f) => sum + f.points, 0);
  let score = Math.min(100, rawSum);
  if (rawSum > 100) {
    factors.push({ label: 'Teto máximo (100)', points: 100 - rawSum });
  }
  if (!reachable) {
    // sem telefone não há como abordar
    score = Math.min(score, 40);
    factors.push({ label: 'Sem telefone (limita a nota a 40)', points: 0 });
  }

  const parts: string[] = [];
  if (!hasSite) parts.push('não tem site');
  else if (site && !site.reachable) parts.push('site fora do ar');
  else if (site && !hasAnyAdPixel(site.pixels)) parts.push('site sem Pixel/GTM');
  else parts.push('tem site');

  if (reviews > 0) parts.push(`tem ${reviews} avaliações`);
  const reason =
    parts.join(', ') +
    (rp >= 14 && (!hasSite || (site && !hasAnyAdPixel(site.pixels)))
      ? ' — cliente não falta'
      : '');

  return { score, tier: tierOf(score), reason, factors };
}
