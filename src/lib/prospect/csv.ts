import { formatCnpj, porteLabel } from './cnpj';
import { hasAnyAdPixel } from './site-audit';
import type { LeadRow } from './types';

// CSV for Excel in Brazil: UTF-8 with BOM and ";" as separator.
// Cells that start with = + - @ (or tab / CR) are prefixed with a quote so a
// business named "=HYPERLINK(...)" cannot run as a formula in Excel.

const COLUMNS: {
  header: string;
  value: (l: LeadRow) => string | number | null;
}[] = [
  { header: 'Nome', value: (l) => l.name },
  { header: 'Categoria', value: (l) => l.category },
  { header: 'Cidade', value: (l) => l.city },
  { header: 'UF', value: (l) => l.state },
  { header: 'Endereço', value: (l) => l.address },
  { header: 'Telefone', value: (l) => l.phone },
  { header: 'Telefone (E.164)', value: (l) => l.phone_e164 },
  { header: 'Tipo de telefone', value: (l) => l.phone_kind },
  { header: 'Site', value: (l) => l.website },
  { header: 'Tem site', value: (l) => (l.website ? 'sim' : 'não') },
  { header: 'Nota', value: (l) => l.rating },
  { header: 'Avaliações', value: (l) => l.review_count },
  { header: 'Situação', value: (l) => l.business_status },
  { header: 'Google Maps', value: (l) => l.maps_url },
  { header: 'Status', value: (l) => l.status },
  { header: 'CNPJ', value: (l) => (l.cnpj ? formatCnpj(l.cnpj) : null) },
  {
    header: 'Razão Social',
    value: (l) =>
      l.cnpj_match_status === 'matched'
        ? (l.cnpj_data?.razao_social ?? null)
        : null,
  },
  {
    header: 'Porte',
    value: (l) =>
      l.cnpj_match_status === 'matched' ? porteLabel(l.cnpj_data) || null : null,
  },
  {
    header: 'Abertura',
    value: (l) =>
      l.cnpj_match_status === 'matched'
        ? (l.cnpj_data?.data_inicio ?? null)
        : null,
  },
  {
    header: 'E-mail (Receita)',
    value: (l) =>
      l.cnpj_match_status === 'matched' ? (l.cnpj_data?.email ?? null) : null,
  },
  {
    header: 'Sócios',
    value: (l) =>
      l.cnpj_match_status === 'matched' && l.cnpj_data?.socios?.length
        ? l.cnpj_data.socios.map((s) => s.nome).join(' / ')
        : null,
  },
  {
    header: 'Site no ar',
    value: (l) =>
      l.site_data ? (l.site_data.reachable ? 'sim' : 'não') : null,
  },
  {
    header: 'Pixel/GTM no site',
    value: (l) =>
      l.site_data?.reachable
        ? hasAnyAdPixel(l.site_data.pixels)
          ? 'sim'
          : 'não'
        : null,
  },
  {
    header: 'Instagram (Site)',
    value: (l) => l.site_data?.socials?.instagram ?? null,
  },
  {
    header: 'E-mail (Site)',
    value: (l) =>
      l.site_data?.emails?.length ? l.site_data.emails.join(' / ') : null,
  },
];

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildLeadsCsv(leads: LeadRow[]): string {
  const lines = [COLUMNS.map((c) => csvCell(c.header)).join(';')];
  for (const lead of leads) {
    lines.push(COLUMNS.map((c) => csvCell(c.value(lead))).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
