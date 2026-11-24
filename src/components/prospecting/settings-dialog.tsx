'use client';

import { Copy, Loader2 } from 'lucide-react';
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
import { apiJson } from '@/lib/prospect/client';

interface SettingsView {
  googleKeyConfigured: boolean;
  googleKeyLast4: string | null;
  monthlyRequestCap: number;
  rankRequestCap: number;
  dataforseoConfigured: boolean;
  dataforseoLogin: string | null;
  rankProvider: 'auto' | 'google' | 'dataforseo';
  webhookUrl: string | null;
  webhookSecretConfigured: boolean;
  webhookSecret?: string;
}

export function ProspectSettingsDialog({
  open,
  onOpenChange,
  canEdit,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('Prospecting');
  const tr = useTranslations('ProspectRank');
  const [view, setView] = useState<SettingsView | null>(null);
  const [key, setKey] = useState('');
  const [cap, setCap] = useState('');
  const [rankCap, setRankCap] = useState('');
  const [dfsLogin, setDfsLogin] = useState('');
  const [dfsPassword, setDfsPassword] = useState('');
  const [rankProvider, setRankProvider] = useState('auto');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !canEdit) return;
    setKey('');
    setSecret(null);
    apiJson<SettingsView>('/api/prospect/settings')
      .then((v) => {
        setView(v);
        setCap(String(v.monthlyRequestCap));
        setRankCap(String(v.rankRequestCap));
        setDfsLogin(v.dataforseoLogin ?? '');
        setRankProvider(v.rankProvider);
        setWebhookUrl(v.webhookUrl ?? '');
      })
      .catch(() => toast.error(t('genericError')));
  }, [open, canEdit, t]);

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        monthlyRequestCap: Number(cap),
        rankRequestCap: Number(rankCap),
        dataforseoLogin: dfsLogin,
        rankProvider,
        webhookUrl,
        ...extra,
      };
      if (key.trim()) body.googleApiKey = key.trim();
      if (dfsPassword.trim()) body.dataforseoPassword = dfsPassword.trim();
      const next = await apiJson<SettingsView>('/api/prospect/settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setView(next);
      setKey('');
      setSecret(next.webhookSecret ?? null);
      toast.success(t('settingsSaved'));
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message !== 'error'
          ? err.message
          : t('genericError')
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settingsTitle')}</DialogTitle>
          <DialogDescription>
            {canEdit ? t('settingsGoogleKeyHint') : t('settingsAdminOnly')}
          </DialogDescription>
        </DialogHeader>

        {canEdit && (
          <div className="space-y-5">
            <div className="grid gap-2">
              <Label htmlFor="prospect-google-key">
                {t('settingsGoogleKey')}
              </Label>
              <Input
                id="prospect-google-key"
                type="password"
                autoComplete="off"
                value={key}
                placeholder={t('settingsGoogleKeyPlaceholder')}
                onChange={(e) => setKey(e.target.value)}
              />
              {view?.googleKeyConfigured && (
                <div className="text-muted-foreground flex items-center justify-between text-xs">
                  <span>
                    {t('settingsGoogleKeySaved', {
                      last4: view.googleKeyLast4 ?? '',
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => {
                      setKey('');
                      void save({ googleApiKey: '' });
                    }}
                  >
                    {t('settingsRemoveKey')}
                  </Button>
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="prospect-cap">{t('settingsCap')}</Label>
              <Input
                id="prospect-cap"
                type="number"
                min={0}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t('settingsCapHint')}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="prospect-rank-cap">{tr('settingsRankCap')}</Label>
              <Input
                id="prospect-rank-cap"
                type="number"
                min={0}
                value={rankCap}
                onChange={(e) => setRankCap(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {tr('settingsRankCapHint')}
              </p>
            </div>

            <div className="grid gap-2">
              <Label>{tr('dfsTitle')}</Label>
              <Input
                aria-label={tr('dfsLogin')}
                placeholder={tr('dfsLogin')}
                autoComplete="off"
                value={dfsLogin}
                onChange={(e) => setDfsLogin(e.target.value)}
              />
              <Input
                aria-label={tr('dfsPassword')}
                type="password"
                autoComplete="new-password"
                placeholder={
                  view?.dataforseoConfigured
                    ? tr('dfsPasswordSet')
                    : tr('dfsPassword')
                }
                value={dfsPassword}
                onChange={(e) => setDfsPassword(e.target.value)}
              />
              <Select
                value={rankProvider}
                items={[
                  { value: 'auto', label: tr('rankAuto') },
                  { value: 'google', label: tr('rankGoogle') },
                  { value: 'dataforseo', label: tr('rankDfs') },
                ]}
                onValueChange={(v) => setRankProvider(String(v))}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={tr('rankProviderLabel')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{tr('rankAuto')}</SelectItem>
                  <SelectItem value="google">{tr('rankGoogle')}</SelectItem>
                  <SelectItem value="dataforseo">{tr('rankDfs')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{tr('dfsHint')}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="prospect-webhook">
                {t('settingsWebhookUrl')}
              </Label>
              <Input
                id="prospect-webhook"
                type="url"
                inputMode="url"
                value={webhookUrl}
                placeholder="https://"
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t('settingsWebhookHint')}
              </p>
              {view?.webhookUrl && (
                <div className="text-muted-foreground flex items-center justify-between text-xs">
                  <span>
                    {view.webhookSecretConfigured
                      ? t('settingsSecretConfigured')
                      : ''}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => void save({ rotateWebhookSecret: true })}
                  >
                    {t('settingsRotate')}
                  </Button>
                </div>
              )}
              {secret && (
                <div className="bg-muted/40 rounded-md border p-3">
                  <p className="mb-1 text-xs font-medium">
                    {t('settingsSecretOnce')}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 text-xs break-all">
                      {secret}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Copy"
                      onClick={() => navigator.clipboard?.writeText(secret)}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
          {canEdit && (
            <Button onClick={() => void save()} disabled={saving}>
              {saving && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              {t('settingsSave')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
