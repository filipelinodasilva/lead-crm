'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { postInChunks, sumBy } from '@/lib/prospect/client';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  /** Resolves the ids to act on ("select all N" is looked up only now). */
  loadIds: () => Promise<string[]>;
  onDone: () => void;
}

interface Progress {
  done: number;
  total: number;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message !== 'error'
    ? err.message
    : fallback;
}

// ---------- pipeline ----------

interface PipelineOption {
  id: string;
  name: string;
  stages: { id: string; name: string; position: number }[];
}

interface PipelineSummary {
  added: number;
  createdContacts: number;
  existingContacts: number;
  skippedNoPhone: number;
  alreadyInPipeline: number;
  failed: number;
}

export function SendPipelineDialog({
  open,
  onOpenChange,
  count,
  loadIds,
  onDone,
  defaultTag,
}: BaseProps & { defaultTag: string }) {
  const t = useTranslations('Prospecting');
  const [pipelines, setPipelines] = useState<PipelineOption[] | null>(null);
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [tag, setTag] = useState(defaultTag);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  // The selection is cleared when the send ends; keep showing how many were sent.
  const [sentCount, setSentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSummary(null);
    setSentCount(null);
    setProgress(null);
    setTag(defaultTag);
    let cancelled = false;
    createClient()
      .from('pipelines')
      .select('id, name, pipeline_stages(id, name, position)')
      .order('created_at')
      .then(({ data }) => {
        if (cancelled) return;
        const list: PipelineOption[] = (data ?? []).map((p) => ({
          id: p.id as string,
          name: p.name as string,
          stages: [
            ...((p.pipeline_stages ?? []) as {
              id: string;
              name: string;
              position: number;
            }[]),
          ].sort((a, b) => a.position - b.position),
        }));
        setPipelines(list);
        setPipelineId((cur) => cur || list[0]?.id || '');
        setStageId((cur) => cur || list[0]?.stages[0]?.id || '');
      });
    return () => {
      cancelled = true;
    };
  }, [open, defaultTag]);

  const current = pipelines?.find((p) => p.id === pipelineId);

  async function run() {
    setRunning(true);
    setSummary(null);
    try {
      const ids = await loadIds();
      setSentCount(ids.length);
      const results = await postInChunks<PipelineSummary>(
        '/api/prospect/leads/pipeline',
        ids,
        { pipelineId, stageId, campaignTag: tag },
        (done, total) => setProgress({ done, total })
      );
      setSummary({
        added: sumBy(results, (r) => r.added),
        createdContacts: sumBy(results, (r) => r.createdContacts),
        existingContacts: sumBy(results, (r) => r.existingContacts),
        skippedNoPhone: sumBy(results, (r) => r.skippedNoPhone),
        alreadyInPipeline: sumBy(results, (r) => r.alreadyInPipeline),
        failed: sumBy(results, (r) => r.failed),
      });
      onDone();
    } catch (err) {
      toast.error(messageOf(err, t('genericError')));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pipelineTitle')}</DialogTitle>
          <DialogDescription>
            {t('pipelineDescription', { count: sentCount ?? count })}
          </DialogDescription>
        </DialogHeader>

        {pipelines && pipelines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noPipelines')}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>{t('pipelineLabel')}</Label>
              <Select
                value={pipelineId}
                items={(pipelines ?? []).map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
                onValueChange={(v) => {
                  const id = String(v);
                  setPipelineId(id);
                  setStageId(
                    pipelines?.find((p) => p.id === id)?.stages[0]?.id ?? ''
                  );
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(pipelines ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('stageLabel')}</Label>
              <Select
                value={stageId}
                items={(current?.stages ?? []).map((st) => ({
                  value: st.id,
                  label: st.name,
                }))}
                onValueChange={(v) => setStageId(String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(current?.stages ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prospect-tag">{t('tagLabel')}</Label>
              <Input
                id="prospect-tag"
                value={tag}
                maxLength={60}
                onChange={(e) => setTag(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">{t('tagHint')}</p>
            </div>
          </div>
        )}

        {running && progress && (
          <p
            className="text-muted-foreground flex items-center gap-2 text-sm"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t('progress', { done: progress.done, total: progress.total })}
          </p>
        )}

        {summary && (
          <ul
            className="bg-muted/40 space-y-1 rounded-md border p-3 text-sm"
            role="status"
          >
            <li>{t('resultAdded', { count: summary.added })}</li>
            <li>
              {t('resultNewContacts', { count: summary.createdContacts })}
            </li>
            <li>
              {t('resultExistingContacts', { count: summary.existingContacts })}
            </li>
            {summary.alreadyInPipeline > 0 && (
              <li>
                {t('resultAlready', { count: summary.alreadyInPipeline })}
              </li>
            )}
            {summary.skippedNoPhone > 0 && (
              <li>{t('resultNoPhone', { count: summary.skippedNoPhone })}</li>
            )}
            {summary.failed > 0 && (
              <li className="text-destructive">
                {t('resultFailed', { count: summary.failed })}
              </li>
            )}
          </ul>
        )}

        {summary && summary.added > 0 && (
          <Link
            href={`/prospecting/campaigns?new=1&pipeline=${pipelineId}&stage=${stageId}`}
            className="text-primary text-sm underline-offset-4 hover:underline"
          >
            {t('createCampaign')}
          </Link>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            {summary ? t('close') : t('cancel')}
          </Button>
          {!summary && (
            <Button
              onClick={run}
              disabled={running || !pipelineId || !stageId || count === 0}
            >
              {running && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              {t('confirmSend', { count })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- webhook ----------

export function SendWebhookDialog({
  open,
  onOpenChange,
  count,
  loadIds,
  onDone,
  configured,
}: BaseProps & { configured: boolean }) {
  const t = useTranslations('Prospecting');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<{
    delivered: number;
    failed: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setProgress(null);
    }
  }, [open]);

  async function run() {
    setRunning(true);
    try {
      const ids = await loadIds();
      const results = await postInChunks<{ delivered: number; failed: number }>(
        '/api/prospect/leads/webhook',
        ids,
        {},
        (done, total) => setProgress({ done, total })
      );
      setResult({
        delivered: sumBy(results, (r) => r.delivered),
        failed: sumBy(results, (r) => r.failed),
      });
      onDone();
    } catch (err) {
      toast.error(messageOf(err, t('genericError')));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('webhookTitle')}</DialogTitle>
          <DialogDescription>
            {configured
              ? t('webhookDescription', { count })
              : t('webhookNotConfigured')}
          </DialogDescription>
        </DialogHeader>
        {running && progress && (
          <p
            className="text-muted-foreground flex items-center gap-2 text-sm"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t('progress', { done: progress.done, total: progress.total })}
          </p>
        )}
        {result && (
          <p
            className={`bg-muted/40 rounded-md border p-3 text-sm ${result.failed ? 'text-destructive' : ''}`}
            role="status"
          >
            {t('webhookResult', result)}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            {result ? t('close') : t('cancel')}
          </Button>
          {configured && !result && (
            <Button onClick={run} disabled={running || count === 0}>
              {running && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              {t('confirmSend', { count })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- discard ----------

export function DiscardDialog({
  open,
  onOpenChange,
  count,
  loadIds,
  onDone,
}: BaseProps) {
  const t = useTranslations('Prospecting');
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const ids = await loadIds();
      const results = await postInChunks<{ discarded: number }>(
        '/api/prospect/leads/discard',
        ids,
        {},
        () => undefined
      );
      toast.success(
        t('discarded', { count: sumBy(results, (r) => r.discarded) })
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(messageOf(err, t('genericError')));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('actionDiscard')}</DialogTitle>
          <DialogDescription>
            {t('discardDescription', { count })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={run}
            disabled={running || count === 0}
          >
            {running && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            {t('actionDiscard')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
