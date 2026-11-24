'use client';

import {
  Building2,
  Download,
  GitBranch,
  Globe,
  Loader2,
  MapPin,
  Search,
  Send,
  Settings,
  Trash2,
  Webhook,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCan } from '@/hooks/use-can';
import {
  apiJson,
  filtersToParams,
  postInChunks,
  sumBy,
} from '@/lib/prospect/client';
import { parseLeadFilters, type LeadFilters } from '@/lib/prospect/filters';
import type { LeadRow, ProviderId } from '@/lib/prospect/types';
import {
  DiscardDialog,
  SendPipelineDialog,
  SendWebhookDialog,
} from './action-dialogs';
import { LeadDrawer } from './lead-drawer';
import { LeadsTable } from './leads-table';
import { ProspectSettingsDialog } from './settings-dialog';

const PAGE_SIZES = [25, 50, 100];
const SEARCH_SIZES = [20, 40, 60];
const MAX_SELECT_ALL = 5000;
const ANY = 'any';

interface Status {
  provider: ProviderId;
  usage: { used: number; cap: number } | null;
  webhookConfigured: boolean;
  cnpjConfigured?: boolean;
}

interface LeadsResponse {
  leads: LeadRow[];
  total: number;
  categories: string[];
}

interface EnrichChunkResult {
  processed: number;
  matched: number;
  review: number;
  none: number;
}

interface SiteAuditChunkResult {
  audited: number;
  noWebsite: number;
  unreachable: number;
  withoutPixel: number;
}

interface SearchSummary {
  found: number;
  created: number;
  warning?: string;
  cnpj?: EnrichChunkResult;
}

/** Raw form state; turned into validated `LeadFilters` after a short pause. */
interface Controls {
  q: string;
  category: string;
  city: string;
  website: string;
  cnpj: string;
  minReviews: string;
  minRating: string;
  mobileOnly: boolean;
  status: string;
}

const EMPTY_CONTROLS: Controls = {
  q: '',
  category: ANY,
  city: '',
  website: ANY,
  cnpj: ANY,
  minReviews: '',
  minRating: '',
  mobileOnly: false,
  status: 'active',
};

function toFilters(c: Controls): LeadFilters {
  return parseLeadFilters({
    q: c.q,
    category: c.category === ANY ? '' : c.category,
    city: c.city,
    website: c.website === ANY ? '' : c.website,
    cnpj: c.cnpj === ANY ? '' : c.cnpj,
    minReviews: c.minReviews,
    minRating: c.minRating,
    mobileOnly: c.mobileOnly,
    status: c.status === 'active' ? '' : c.status,
  });
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Download through a link so the browser saves the file without leaving the page. */
function downloadCsv(params: URLSearchParams) {
  const a = document.createElement('a');
  a.href = `/api/prospect/leads/export?${params}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type DialogName = 'pipeline' | 'webhook' | 'discard' | 'settings' | null;

export function ProspectingPage() {
  const t = useTranslations('Prospecting');
  const tr = useTranslations('ProspectRank');
  const canAct = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');

  const [status, setStatus] = useState<Status | null>(null);
  const [controls, setControls] = useState<Controls>(EMPTY_CONTROLS);
  const debounced = useDebounced(controls, 350);
  const filters = useMemo(() => toFilters(debounced), [debounced]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openLead, setOpenLead] = useState<LeadRow | null>(null);
  const [allMatching, setAllMatching] = useState(false);
  const [dialog, setDialog] = useState<DialogName>(null);

  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [maxResults, setMaxResults] = useState(20);
  const [searching, setSearching] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [auditingSites, setAuditingSites] = useState(false);
  const [lastQuery, setLastQuery] = useState('');

  const loadStatus = useCallback(() => {
    apiJson<Status>('/api/prospect/status')
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  useEffect(loadStatus, [loadStatus]);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const qParam = sp.get('q')?.trim();
    const locParam = sp.get('loc')?.trim();
    if (qParam) setQuery(qParam.slice(0, 80));
    if (locParam) setLocation(locParam.slice(0, 120));
  }, []);

  const filtersKey = JSON.stringify(filters);
  // A new filter or page size starts again from page 1 with nothing selected.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
    setAllMatching(false);
  }, [filtersKey, pageSize]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = filtersToParams(filters);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    apiJson<LeadsResponse>(`/api/prospect/leads?${params}`)
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && toast.error(t('genericError')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page, pageSize, refreshKey]);

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const selectedCount = allMatching
    ? Math.min(total, MAX_SELECT_ALL)
    : selected.size;
  const pageAllSelected =
    leads.length > 0 && leads.every((l) => selected.has(l.id));

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    try {
      const r = await apiJson<SearchSummary>('/api/prospect/search', {
        method: 'POST',
        body: JSON.stringify({ query, location, maxResults }),
      });
      toast.success(t('searchDone', { found: r.found, created: r.created }));
      if (r.cnpj && r.cnpj.matched + r.cnpj.review > 0) {
        toast.info(
          t('enrichDone', {
            matched: r.cnpj.matched,
            review: r.cnpj.review,
            none: r.cnpj.none,
          })
        );
      }
      if (r.warning) toast.warning(t('searchWarning', { message: r.warning }));
      setLastQuery(query.trim());
      setControls(EMPTY_CONTROLS);
      setRefreshKey((k) => k + 1);
      loadStatus();
    } catch (err) {
      const code = (err as { code?: string }).code;
      toast.error(
        code === 'quota'
          ? t('quotaReached')
          : err instanceof Error && err.message !== 'error'
            ? err.message
            : t('genericError')
      );
    } finally {
      setSearching(false);
    }
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setAllMatching(false);
    setSelected((cur) => {
      const next = new Set(cur);
      for (const l of leads) {
        if (checked) next.add(l.id);
        else next.delete(l.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  const loadIds = useCallback(async (): Promise<string[]> => {
    if (!allMatching) return [...selected];
    const r = await apiJson<{ ids: string[] }>('/api/prospect/leads/ids', {
      method: 'POST',
      body: JSON.stringify({ filters }),
    });
    return r.ids;
  }, [allMatching, selected, filters]);

  const afterAction = useCallback(() => {
    setSelected(new Set());
    setAllMatching(false);
    setRefreshKey((k) => k + 1);
    loadStatus();
  }, [loadStatus]);

  async function runBatchEnrich() {
    setEnriching(true);
    try {
      const ids = await loadIds();
      const chunks = await postInChunks<EnrichChunkResult>(
        '/api/prospect/leads/enrich',
        ids,
        {},
        () => undefined
      );
      toast.success(
        t('enrichDone', {
          matched: sumBy(chunks, (c) => c.matched),
          review: sumBy(chunks, (c) => c.review),
          none: sumBy(chunks, (c) => c.none),
        })
      );
      afterAction();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message !== 'error'
          ? err.message
          : t('genericError')
      );
    } finally {
      setEnriching(false);
    }
  }

  async function runBatchSiteAudit() {
    setAuditingSites(true);
    try {
      const ids = await loadIds();
      const chunks = await postInChunks<SiteAuditChunkResult>(
        '/api/prospect/leads/site-audit',
        ids,
        { force: true },
        () => undefined
      );
      toast.success(
        t('auditSiteDone', {
          audited: sumBy(chunks, (c) => c.audited),
          withoutPixel: sumBy(chunks, (c) => c.withoutPixel),
          unreachable: sumBy(chunks, (c) => c.unreachable),
        })
      );
      afterAction();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message !== 'error'
          ? err.message
          : t('genericError')
      );
    } finally {
      setAuditingSites(false);
    }
  }

  const activeLead = useMemo(
    () =>
      openLead
        ? ((data?.leads ?? []).find((l) => l.id === openLead.id) ?? openLead)
        : null,
    [openLead, data?.leads]
  );

  const set = <K extends keyof Controls>(key: K, value: Controls[K]) =>
    setControls((c) => ({ ...c, [key]: value }));
  const dirty = JSON.stringify(controls) !== JSON.stringify(EMPTY_CONTROLS);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          {status?.usage && (
            <span className="text-muted-foreground text-xs">
              {t('usage', { used: status.usage.used, cap: status.usage.cap })}
            </span>
          )}
          <Link
            href="/prospecting/campaigns"
            className={buttonVariants({ variant: 'outline' })}
          >
            <Send className="h-4 w-4" aria-hidden />
            {t('campaigns')}
          </Link>
          <Link
            href="/prospecting/ranking"
            className={buttonVariants({ variant: 'outline' })}
          >
            <MapPin className="h-4 w-4" aria-hidden />
            {tr('ranking')}
          </Link>
          <Button variant="outline" onClick={() => setDialog('settings')}>
            <Settings className="h-4 w-4" aria-hidden />
            {t('settings')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={runSearch}
            className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="prospect-query">{t('searchQuery')}</Label>
              <Input
                id="prospect-query"
                required
                minLength={2}
                maxLength={80}
                value={query}
                placeholder={t('searchQueryPlaceholder')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="prospect-location">{t('searchLocation')}</Label>
              <Input
                id="prospect-location"
                required
                minLength={2}
                maxLength={120}
                value={location}
                placeholder={t('searchLocationPlaceholder')}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('searchSize')}</Label>
              <Select
                value={String(maxResults)}
                items={SEARCH_SIZES.map((n) => ({
                  value: String(n),
                  label: t('searchUpTo', { count: n }),
                }))}
                onValueChange={(v) => setMaxResults(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEARCH_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {t('searchUpTo', { count: n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={searching || !canAct}>
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Search className="h-4 w-4" aria-hidden />
              )}
              {searching ? t('searching') : t('searchButton')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="f-q">{t('filterSearch')}</Label>
              <Input
                id="f-q"
                value={controls.q}
                onChange={(e) => set('q', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('filterCategory')}</Label>
              <Select
                value={controls.category}
                items={[
                  { value: ANY, label: t('filterAllCategories') },
                  ...(data?.categories ?? []).map((c) => ({
                    value: c,
                    label: c,
                  })),
                ]}
                onValueChange={(v) => set('category', String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>
                    {t('filterAllCategories')}
                  </SelectItem>
                  {(data?.categories ?? []).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="f-city">{t('filterCity')}</Label>
              <Input
                id="f-city"
                value={controls.city}
                onChange={(e) => set('city', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('filterWebsite')}</Label>
              <Select
                value={controls.website}
                items={[
                  { value: ANY, label: t('filterWebsiteAny') },
                  { value: 'with', label: t('filterWebsiteWith') },
                  { value: 'without', label: t('filterWebsiteWithout') },
                ]}
                onValueChange={(v) => set('website', String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('filterWebsiteAny')}</SelectItem>
                  <SelectItem value="with">{t('filterWebsiteWith')}</SelectItem>
                  <SelectItem value="without">
                    {t('filterWebsiteWithout')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="f-reviews">{t('filterMinReviews')}</Label>
              <Input
                id="f-reviews"
                type="number"
                min={0}
                value={controls.minReviews}
                onChange={(e) => set('minReviews', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="f-rating">{t('filterMinRating')}</Label>
              <Input
                id="f-rating"
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={controls.minRating}
                onChange={(e) => set('minRating', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('filterStatus')}</Label>
              <Select
                value={controls.status}
                items={[
                  { value: 'active', label: t('statusActive') },
                  { value: 'new', label: t('statusNew') },
                  { value: 'in_pipeline', label: t('statusInPipeline') },
                  { value: 'discarded', label: t('statusDiscarded') },
                  { value: 'all', label: t('statusAll') },
                ]}
                onValueChange={(v) => set('status', String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('statusActive')}</SelectItem>
                  <SelectItem value="new">{t('statusNew')}</SelectItem>
                  <SelectItem value="in_pipeline">
                    {t('statusInPipeline')}
                  </SelectItem>
                  <SelectItem value="discarded">
                    {t('statusDiscarded')}
                  </SelectItem>
                  <SelectItem value="all">{t('statusAll')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t('filterCnpj')}</Label>
              <Select
                value={controls.cnpj}
                items={[
                  { value: ANY, label: t('filterCnpjAny') },
                  { value: 'matched', label: t('filterCnpjMatched') },
                  { value: 'review', label: t('filterCnpjReview') },
                  { value: 'unchecked', label: t('filterCnpjUnchecked') },
                ]}
                onValueChange={(v) => set('cnpj', String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('filterCnpjAny')}</SelectItem>
                  <SelectItem value="matched">
                    {t('filterCnpjMatched')}
                  </SelectItem>
                  <SelectItem value="review">
                    {t('filterCnpjReview')}
                  </SelectItem>
                  <SelectItem value="unchecked">
                    {t('filterCnpjUnchecked')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3">
              <Label className="flex cursor-pointer items-center gap-2 pb-2.5 font-normal">
                <Checkbox
                  checked={controls.mobileOnly}
                  onCheckedChange={(c) => set('mobileOnly', Boolean(c))}
                />
                {t('filterMobileOnly')}
              </Label>
            </div>
          </div>
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setControls(EMPTY_CONTROLS)}
            >
              {t('clearFilters')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-0">
          {selectedCount > 0 && (
            <div className="bg-card sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <span className="text-sm font-medium">
                {t('selectedCount', { count: selectedCount })}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!canAct}
                  onClick={() => setDialog('pipeline')}
                >
                  <GitBranch className="h-4 w-4" aria-hidden />
                  {t('actionPipeline')}
                </Button>
                {status?.cnpjConfigured && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canAct || enriching}
                    onClick={runBatchEnrich}
                  >
                    {enriching ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Building2 className="h-4 w-4" aria-hidden />
                    )}
                    {enriching ? t('enriching') : t('actionEnrich')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canAct || auditingSites}
                  onClick={runBatchSiteAudit}
                >
                  {auditingSites ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Globe className="h-4 w-4" aria-hidden />
                  )}
                  {auditingSites ? t('auditingSite') : t('actionAuditSite')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canAct}
                  onClick={() => setDialog('webhook')}
                >
                  <Webhook className="h-4 w-4" aria-hidden />
                  {t('actionWebhook')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadCsv(filtersToParams(filters))}
                >
                  <Download className="h-4 w-4" aria-hidden />
                  {t('actionExport')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canAct}
                  onClick={() => setDialog('discard')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {t('actionDiscard')}
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  {t('clearSelection')}
                </Button>
              </div>
            </div>
          )}

          {selectedCount === 0 && leads.length > 0 && (
            <p className="text-muted-foreground px-4 pt-3 text-xs">
              {t('selectHint')}
            </p>
          )}

          {!allMatching && pageAllSelected && total > leads.length && (
            <div className="px-4 text-sm">
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => setAllMatching(true)}
              >
                {t('selectAllMatching', { count: total })}
              </button>
            </div>
          )}
          {allMatching && (
            <div className="text-muted-foreground px-4 text-sm">
              {t('allMatchingSelected', { count: total })}
            </div>
          )}

          {loading && !data ? (
            <p className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t('loading')}
            </p>
          ) : leads.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              {dirty ? t('emptyFiltered') : t('empty')}
            </p>
          ) : (
            <div
              className={loading ? 'opacity-60 transition-opacity' : undefined}
            >
              <LeadsTable
                leads={leads}
                selected={selected}
                allMatching={allMatching}
                onToggle={toggle}
                onTogglePage={togglePage}
                onOpen={setOpenLead}
              />
              <LeadDrawer
                lead={activeLead}
                cnpjConfigured={Boolean(status?.cnpjConfigured)}
                onClose={() => setOpenLead(null)}
                onChanged={() => setRefreshKey((k) => k + 1)}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              {t('total', { count: total })}
            </span>
            <div className="flex items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => setPageSize(Number(v))}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('prev')}
              </Button>
              <span className="text-muted-foreground">
                {t('pageOf', { page, pages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <SendPipelineDialog
        open={dialog === 'pipeline'}
        onOpenChange={(o) => setDialog(o ? 'pipeline' : null)}
        count={selectedCount}
        loadIds={loadIds}
        onDone={afterAction}
        defaultTag={lastQuery || (filters.category ?? '')}
      />
      <SendWebhookDialog
        open={dialog === 'webhook'}
        onOpenChange={(o) => setDialog(o ? 'webhook' : null)}
        count={selectedCount}
        loadIds={loadIds}
        onDone={afterAction}
        configured={Boolean(status?.webhookConfigured)}
      />
      <DiscardDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => setDialog(o ? 'discard' : null)}
        count={selectedCount}
        loadIds={loadIds}
        onDone={afterAction}
      />
      <ProspectSettingsDialog
        open={dialog === 'settings'}
        onOpenChange={(o) => setDialog(o ? 'settings' : null)}
        canEdit={canEditSettings}
        onSaved={loadStatus}
      />
    </div>
  );
}
