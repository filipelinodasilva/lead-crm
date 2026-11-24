'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  QrCode,
  ShieldAlert,
  Star,
  Trash2,
  Unplug,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  refreshWhatsAppConnections,
  useWhatsAppConnections,
  type ConnectionSummary,
} from '@/hooks/use-whatsapp-connections';
import { SettingsPanelHead } from './settings-panel-head';
import { WhatsAppConfig } from './whatsapp-config';

interface QrState {
  state: string;
  qr?: { base64: string | null } | null;
}

/**
 * Aba WhatsApp: lista as conexões da conta (vários números por QR code e uma API oficial da Meta).
 * Cada conexão mostra o estado, pode ser renomeada, definida como padrão ou removida.
 */
export function WhatsAppSettings() {
  const t = useTranslations('SettingsConnections');
  const { connections, refresh } = useWhatsAppConnections();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    void fetch('/api/whatsapp/evolution', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { configured?: boolean } | null) => setConfigured(d?.configured ?? false))
      .catch(() => setConfigured(false));
  }, []);

  const hasMeta = connections.some((c) => c.provider === 'meta');

  const addQr = async () => {
    setAdding(true);
    try {
      const res = await fetch('/api/whatsapp/evolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('errorGeneric'));
      await refreshWhatsAppConnections();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={addQr} disabled={adding || configured === false}>
              {adding ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
              {t('addQr')}
            </Button>
            {!hasMeta ? (
              <Button variant="outline" onClick={() => setShowMeta((v) => !v)}>
                {t('addMeta')}
              </Button>
            ) : null}
          </div>
        }
      />

      {configured === false ? (
        <Alert>
          <AlertTitle>{t('notConfiguredTitle')}</AlertTitle>
          <AlertDescription>{t('notConfiguredDesc')}</AlertDescription>
        </Alert>
      ) : null}

      {connections.length === 0 && !showMeta ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</CardContent>
        </Card>
      ) : null}

      <div className="space-y-4">
        {connections.map((c) => (
          <ConnectionCard
            key={c.id}
            connection={c}
            total={connections.length}
            onChanged={refresh}
          />
        ))}
      </div>

      {hasMeta || showMeta ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t('metaSection')}</h3>
          <WhatsAppConfig />
        </div>
      ) : null}

      <Alert>
        <ShieldAlert className="size-4" />
        <AlertTitle>{t('riskTitle')}</AlertTitle>
        <AlertDescription>{t('riskText')}</AlertDescription>
      </Alert>
    </div>
  );
}

function ConnectionCard({
  connection,
  total,
  onChanged,
}: {
  connection: ConnectionSummary;
  total: number;
  onChanged: () => void;
}) {
  const t = useTranslations('SettingsConnections');
  const isQr = connection.provider === 'evolution';
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(connection.name ?? '');
  const [live, setLive] = useState<QrState | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/evolution?id=${connection.id}`, { cache: 'no-store' });
      if (res.ok) setLive((await res.json()) as QrState);
    } catch {
      /* mantém o último estado */
    }
  }, [connection.id]);

  // Conexão QR: confere o estado ao abrir e, enquanto estiver conectando, atualiza o QR.
  const connected = isQr ? live?.state === 'open' || (live === null && connection.status === 'connected') : connection.status === 'connected';
  useEffect(() => {
    if (!isQr) return;
    void poll();
  }, [isQr, poll]);
  useEffect(() => {
    if (!isQr || connected) return;
    timer.current = setInterval(poll, 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [isQr, connected, poll]);
  useEffect(() => {
    if (isQr && connected) onChanged();
    // só reage à mudança de conectado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const api = async (init: RequestInit, url = '/api/whatsapp/connections') => {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('errorGeneric'));
      return data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorGeneric'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!name.trim()) return;
    const ok = await api({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: connection.id, name }),
    });
    if (ok) {
      setRenaming(false);
      onChanged();
    }
  };

  const makeDefault = async () => {
    const ok = await api({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: connection.id, is_default: true }),
    });
    if (ok) onChanged();
  };

  const regenerate = async () => {
    const ok = await api(
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: connection.id }) },
      '/api/whatsapp/evolution',
    );
    if (ok) void poll();
  };

  const remove = async () => {
    if (!window.confirm(t('confirmRemove', { name: connection.name ?? '' }))) return;
    const ok = await api({ method: 'DELETE' }, isQr ? `/api/whatsapp/evolution?id=${connection.id}` : `/api/whatsapp/config`);
    if (ok) {
      toast.success(t('removed'));
      onChanged();
      void refreshWhatsAppConnections();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {isQr ? <QrCode className="size-4" /> : null}
              {renaming ? (
                <span className="flex items-center gap-2">
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-56" maxLength={60} />
                  <Button size="sm" onClick={rename} disabled={busy}>
                    {t('save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                    {t('cancel')}
                  </Button>
                </span>
              ) : (
                <>
                  {connection.name || (isQr ? t('defaultNameQr') : t('defaultNameMeta'))}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setRenaming(true)}
                    aria-label={t('rename')}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </>
              )}
              {connection.is_default ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <Star className="size-3" />
                  {t('default')}
                </span>
              ) : null}
            </CardTitle>
            <CardDescription className="mt-1 flex items-center gap-2">
              <span>{isQr ? t('providerQr') : t('providerMeta')}</span>
              <span aria-hidden>·</span>
              {connected ? (
                <span className="inline-flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="size-3.5" />
                  {t('connected')}
                </span>
              ) : (
                <span>{t('disconnected')}</span>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {!connection.is_default && total > 1 ? (
              <Button size="sm" variant="outline" onClick={makeDefault} disabled={busy}>
                <Star className="mr-1.5 size-3.5" />
                {t('makeDefault')}
              </Button>
            ) : null}
            {isQr && !connected ? (
              <Button size="sm" variant="outline" onClick={regenerate} disabled={busy}>
                {t('regenerate')}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={remove} disabled={busy}>
              {connected && isQr ? <Unplug className="mr-1.5 size-3.5" /> : <Trash2 className="mr-1.5 size-3.5" />}
              {connected && isQr ? t('disconnect') : t('remove')}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isQr && !connected ? (
        <CardContent>
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <div className="flex size-56 shrink-0 items-center justify-center rounded-md border border-border bg-white p-2">
              {live?.qr?.base64 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={live.qr.base64} alt={t('qrAlt')} className="size-full object-contain" />
              ) : (
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t('scanTitle')}</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>{t('step1')}</li>
                <li>{t('step2')}</li>
                <li>{t('step3')}</li>
              </ol>
              <p className="text-xs">{t('qrRefresh')}</p>
            </div>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
