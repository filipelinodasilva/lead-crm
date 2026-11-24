'use client';

import { Check, ExternalLink, Star, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCnpj, porteLabel } from '@/lib/prospect/cnpj';
import { scoreLead } from '@/lib/prospect/score';
import { hasAnyAdPixel } from '@/lib/prospect/site-audit';
import type { LeadRow } from '@/lib/prospect/types';
import { cn } from '@/lib/utils';

import { WhatsAppActions } from '@/components/whatsapp/whatsapp-actions';

import { TIER_STYLE } from './lead-drawer';

interface LeadsTableProps {
  leads: LeadRow[];
  selected: Set<string>;
  allMatching: boolean;
  onToggle: (id: string) => void;
  onTogglePage: (checked: boolean) => void;
  /** Opens the lead's side panel. */
  onOpen: (lead: LeadRow) => void;
}

function StatusBadge({ status }: { status: LeadRow['status'] }) {
  const t = useTranslations('Prospecting');
  if (status === 'in_pipeline') return <Badge>{t('statusInPipeline')}</Badge>;
  if (status === 'discarded')
    return <Badge variant="outline">{t('statusDiscarded')}</Badge>;
  return <Badge variant="secondary">{t('statusNew')}</Badge>;
}

export function LeadsTable({
  leads,
  selected,
  allMatching,
  onToggle,
  onTogglePage,
  onOpen,
}: LeadsTableProps) {
  const t = useTranslations('Prospecting');
  const tLead = useTranslations('ProspectLead');
  const pageSelected =
    leads.length > 0 && leads.every((l) => allMatching || selected.has(l.id));
  const pageSome = !pageSelected && leads.some((l) => selected.has(l.id));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label={t('selectedCount', { count: leads.length })}
              checked={pageSelected}
              indeterminate={pageSome}
              onCheckedChange={(checked) => onTogglePage(Boolean(checked))}
            />
          </TableHead>
          <TableHead className="w-24">{t('colScore')}</TableHead>
          <TableHead>{t('colName')}</TableHead>
          <TableHead className="hidden md:table-cell">
            {t('colCategory')}
          </TableHead>
          <TableHead>{t('colPhone')}</TableHead>
          <TableHead className="hidden sm:table-cell">
            {t('colWebsite')}
          </TableHead>
          <TableHead className="hidden lg:table-cell">
            {t('colRating')}
          </TableHead>
          <TableHead className="hidden md:table-cell">
            {t('colStatus')}
          </TableHead>
          <TableHead className="w-20 text-right">
            <span className="sr-only">{t('colActions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((lead) => {
          const checked = allMatching || selected.has(lead.id);
          const result = scoreLead(lead);
          return (
            <TableRow
              key={lead.id}
              data-state={checked ? 'selected' : undefined}
              className="cursor-pointer"
              onClick={() => onOpen(lead)}
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  aria-label={lead.name}
                  checked={checked}
                  disabled={allMatching}
                  onCheckedChange={() => onToggle(lead.id)}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="text-primary text-lg font-semibold tabular-nums">
                    {result.score}
                  </span>
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                      TIER_STYLE[result.tier]
                    )}
                  >
                    {tLead(`tier_${result.tier}`)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="max-w-[18rem]">
                <button
                  type="button"
                  className="block max-w-full truncate text-left font-medium hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(lead);
                  }}
                >
                  {lead.name}
                </button>
                <div className="text-muted-foreground truncate text-xs">
                  {result.reason}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {[lead.city, lead.state].filter(Boolean).join(' - ') ||
                    lead.address}
                </div>
                {lead.cnpj_match_status === 'matched' && lead.cnpj && (
                  <div
                    className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]"
                    title={formatCnpj(lead.cnpj)}
                  >
                    <span className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 rounded border px-1.5 py-0.5 font-medium">
                      {porteLabel(lead.cnpj_data) || 'CNPJ'}
                      {lead.cnpj_data?.data_inicio
                        ? ` · ${lead.cnpj_data.data_inicio.slice(0, 4)}`
                        : ''}
                    </span>
                    {lead.cnpj_data?.socios?.[0]?.nome && (
                      <span className="text-muted-foreground max-w-[11rem] truncate">
                        {lead.cnpj_data.socios[0].nome}
                      </span>
                    )}
                  </div>
                )}
                {lead.cnpj_match_status === 'review' && (
                  <div className="mt-1">
                    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
                      {tLead('cnpjReviewBadge')}
                    </span>
                  </div>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground hidden text-sm md:table-cell">
                {lead.category ?? ''}
              </TableCell>
              <TableCell className="text-sm whitespace-nowrap">
                {lead.phone ? (
                  <div className="flex flex-col gap-0.5">
                    <span>{lead.phone}</span>
                    {lead.phone_kind !== 'unknown' && (
                      <span className="text-muted-foreground text-xs">
                        {lead.phone_kind === 'mobile'
                          ? t('phoneMobile')
                          : t('phoneLandline')}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {lead.website ? (
                  <div className="flex flex-col items-start gap-1">
                    <a
                      href={lead.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                      title={lead.website}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Check className="h-4 w-4" aria-hidden />
                      {t('websiteYes')}
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                    {lead.site_data && (
                      <span
                        className={cn(
                          'rounded border px-1.5 py-0.5 text-[10px] font-medium',
                          !lead.site_data.reachable
                            ? 'border-red-500/40 bg-red-500/10 text-red-300'
                            : hasAnyAdPixel(lead.site_data.pixels)
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                              : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        )}
                      >
                        {!lead.site_data.reachable
                          ? t('siteOffline')
                          : hasAnyAdPixel(lead.site_data.pixels)
                            ? t('siteHasPixel')
                            : t('siteNoPixel')}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
                    <X className="h-4 w-4" aria-hidden />
                    {t('websiteNo')}
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden text-sm whitespace-nowrap lg:table-cell">
                {lead.rating !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <Star
                      className="h-3.5 w-3.5 fill-current text-amber-500"
                      aria-hidden
                    />
                    {lead.rating.toFixed(1)}
                    <span className="text-muted-foreground text-xs">
                      ({lead.review_count})
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <StatusBadge status={lead.status} />
              </TableCell>
              <TableCell className="text-right">
                <WhatsAppActions
                  phone={lead.phone_e164 ?? lead.phone}
                  name={lead.name}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
