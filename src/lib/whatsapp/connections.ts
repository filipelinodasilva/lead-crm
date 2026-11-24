/**
 * Conexões de WhatsApp da conta (várias por conta).
 *
 * Todo código que precisa "do WhatsApp da conta" passa por aqui. Consultar a tabela
 * `whatsapp_config` filtrando só por `account_id` e esperando uma linha quebra assim que a
 * conta tem duas conexões; o teste `connections-guard.test.ts` impede esse padrão.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ConnectionProvider = 'meta' | 'evolution'

/** Linha de whatsapp_config. Campos extras da Meta ficam acessíveis pelo índice. */
export interface Connection {
  id: string
  account_id: string
  user_id: string
  name: string | null
  provider: ConnectionProvider
  phone_number_id: string
  waba_id: string | null
  access_token: string
  verify_token: string | null
  status: 'connected' | 'disconnected'
  is_default: boolean
  connected_at: string | null
  created_at: string
  [key: string]: unknown
}

const ORDER = (q: ReturnType<ReturnType<SupabaseClient['from']>['select']>) =>
  q.order('is_default', { ascending: false }).order('created_at', { ascending: true })

/** Todas as conexões da conta: a padrão primeiro. */
export async function listConnections(db: SupabaseClient, accountId: string): Promise<Connection[]> {
  const { data, error } = await ORDER(db.from('whatsapp_config').select('*').eq('account_id', accountId))
  if (error) {
    console.error('[connections] listar falhou:', error.message)
    return []
  }
  return (data ?? []) as Connection[]
}

/** A conexão padrão (ou, se nenhuma estiver marcada, a mais antiga). */
export async function getDefaultConnection(db: SupabaseClient, accountId: string): Promise<Connection | null> {
  const all = await listConnections(db, accountId)
  return all[0] ?? null
}

export async function getConnectionById(
  db: SupabaseClient,
  accountId: string,
  connectionId: string,
): Promise<Connection | null> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('id', connectionId)
    .maybeSingle()
  if (error) console.error('[connections] buscar por id falhou:', error.message)
  return (data as Connection | null) ?? null
}

/** A conexão da API oficial da Meta (no máximo uma por conta). */
export async function getMetaConnection(db: SupabaseClient, accountId: string): Promise<Connection | null> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'meta')
    .limit(1)
  if (error) console.error('[connections] buscar Meta falhou:', error.message)
  return ((data ?? [])[0] as Connection | undefined) ?? null
}

/**
 * Conexão a usar para uma conversa: a que está gravada nela e, se não houver (conversa antiga ou
 * conexão removida), a padrão da conta.
 */
export async function getConnectionForConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId?: string | null,
): Promise<Connection | null> {
  if (conversationId) {
    const { data } = await db
      .from('conversations')
      .select('whatsapp_config_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    const id = (data as { whatsapp_config_id?: string | null } | null)?.whatsapp_config_id
    if (id) {
      const own = await getConnectionById(db, accountId, id)
      if (own) return own
    }
  }
  return getDefaultConnection(db, accountId)
}

/** Resolve a conexão por id explícito, pela conversa ou pela padrão, nessa ordem. */
export async function resolveConnection(
  db: SupabaseClient,
  accountId: string,
  opts: { connectionId?: string | null; conversationId?: string | null } = {},
): Promise<Connection | null> {
  if (opts.connectionId) return getConnectionById(db, accountId, opts.connectionId)
  return getConnectionForConversation(db, accountId, opts.conversationId)
}

/** Nome para mostrar na interface. */
export function connectionLabel(c: Pick<Connection, 'name' | 'provider'>): string {
  return c.name || (c.provider === 'evolution' ? 'WhatsApp QR' : 'WhatsApp oficial')
}

/**
 * Garante uma conexão padrão na conta: se a padrão foi removida, a mais antiga assume.
 * Chamar depois de remover uma conexão.
 */
export async function ensureDefaultConnection(db: SupabaseClient, accountId: string): Promise<void> {
  const all = await listConnections(db, accountId)
  if (all.length === 0 || all.some((c) => c.is_default)) return
  await db.from('whatsapp_config').update({ is_default: true }).eq('id', all[0].id)
}
