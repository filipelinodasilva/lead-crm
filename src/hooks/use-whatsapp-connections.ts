'use client';

import { useCallback, useEffect, useState } from 'react';

export type ConnectionProvider = 'meta' | 'evolution';

export interface ConnectionSummary {
  id: string;
  name: string | null;
  provider: ConnectionProvider;
  status: 'connected' | 'disconnected';
  is_default: boolean;
}

let cache: ConnectionSummary[] | undefined;
let inflight: Promise<ConnectionSummary[]> | null = null;
const listeners = new Set<(c: ConnectionSummary[]) => void>();

async function fetchConnections(): Promise<ConnectionSummary[]> {
  try {
    const res = await fetch('/api/whatsapp/connections', { cache: 'no-store' });
    const data = res.ok ? ((await res.json()) as { connections?: ConnectionSummary[] }) : {};
    cache = data.connections ?? [];
  } catch {
    cache = cache ?? [];
  }
  listeners.forEach((l) => l(cache!));
  return cache;
}

function load(force = false): Promise<ConnectionSummary[]> {
  if (!force && cache) return Promise.resolve(cache);
  if (!inflight || force) {
    inflight = fetchConnections().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Atualiza a lista em todas as telas (chamar depois de adicionar ou remover uma conexão). */
export function refreshWhatsAppConnections(): Promise<ConnectionSummary[]> {
  return load(true);
}

/** Conexões de WhatsApp da conta. Lista vazia enquanto carrega. */
export function useWhatsAppConnections(): { connections: ConnectionSummary[]; refresh: () => void } {
  const [connections, setConnections] = useState<ConnectionSummary[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    const listener = (c: ConnectionSummary[]) => alive && setConnections(c);
    listeners.add(listener);
    void load().then((c) => alive && setConnections(c));
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, []);
  const refresh = useCallback(() => {
    void load(true);
  }, []);
  return { connections, refresh };
}

/**
 * Provedor de uma conversa: o da conexão gravada nela ou, sem conexão, o da padrão.
 * Com 'evolution' (QR code) não existe janela de 24 horas nem exigência de modelo.
 */
export function providerForConversation(
  connections: ConnectionSummary[],
  whatsappConfigId?: string | null,
): ConnectionProvider | null {
  const own = whatsappConfigId ? connections.find((c) => c.id === whatsappConfigId) : undefined;
  return (own ?? connections.find((c) => c.is_default) ?? connections[0])?.provider ?? null;
}
