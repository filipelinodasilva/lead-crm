/**
 * Evolution API (WhatsApp por QR code, não oficial) como segundo provedor.
 *
 * Como encaixa no resto do app: a conta que usa a Evolution guarda em
 * `whatsapp_config` o `phone_number_id` com o prefixo `evo_` + nome da instância,
 * e o `access_token` (criptografado) com a chave da instância. As funções de envio de
 * `meta-api.ts` olham esse prefixo e desviam para cá, então caixa de entrada, automações,
 * fluxos, disparos e API pública passam a enviar pela Evolution sem mudar nenhum deles.
 *
 * Só roda no servidor. A chave global (EVOLUTION_API_KEY) nunca vai ao navegador.
 */

import { randomInt } from 'node:crypto'

export const EVOLUTION_PREFIX = 'evo_'

export function isEvolutionPhoneId(id?: string | null): boolean {
  return !!id && id.startsWith(EVOLUTION_PREFIX)
}

export function instanceFromPhoneId(phoneNumberId: string): string {
  return phoneNumberId.slice(EVOLUTION_PREFIX.length)
}

export function phoneIdFromInstance(instance: string): string {
  return `${EVOLUTION_PREFIX}${instance}`
}

export class EvolutionApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'EvolutionApiError'
    this.status = status
  }
}

export function evolutionBaseUrl(): string {
  return (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '')
}

export function evolutionConfigured(): boolean {
  return !!(evolutionBaseUrl() && process.env.EVOLUTION_API_KEY)
}

interface EvoRequest {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT'
  /** Chave da instância (envio) ou a chave global (gerenciar instâncias). */
  apikey: string
  body?: unknown
}

async function evo<T = Record<string, unknown>>(
  path: string,
  { method = 'GET', apikey, body }: EvoRequest,
): Promise<T> {
  const base = evolutionBaseUrl()
  if (!base) throw new EvolutionApiError('EVOLUTION_API_URL não configurada', 500)
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
    const first = (data as { response?: { message?: unknown[] } } | null)?.response?.message?.[0] as
      | { exists?: boolean; number?: string }
      | undefined
    if (first && first.exists === false) {
      throw new EvolutionApiError(`O número ${first.number ?? ''} não tem WhatsApp.`.replace('  ', ' '), 400)
    }
    const d = data as { message?: unknown; response?: { message?: unknown } } | null
    const raw = d?.response?.message ?? d?.message ?? text
    const msg = Array.isArray(raw) ? raw.map((x) => JSON.stringify(x)).join('; ') : String(raw)
    throw new EvolutionApiError(`Evolution API ${response.status}: ${msg}`.slice(0, 400), response.status)
  }
  return data as T
}

// ------------------------------------------------------------
// Ritmo de envio. Número novo em API não oficial é banido com
// facilidade: mantemos um intervalo mínimo com variação entre
// envios da mesma instância (vale para disparos e automações).
// ------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function pace(instance: string): Promise<void> {
  const g = globalThis as unknown as { __evoNext?: Map<string, number> }
  g.__evoNext ??= new Map()
  const now = Date.now()
  const at = Math.max(now, g.__evoNext.get(instance) ?? 0)
  g.__evoNext.set(instance, at + 1500 + randomInt(0, 2500))
  if (at > now) await sleep(at - now)
}

// ------------------------------------------------------------
// Gerenciar instâncias (chave global)
// ------------------------------------------------------------
export interface EvolutionQr {
  /** data:image/png;base64,... */
  base64: string | null
  code: string | null
  pairingCode: string | null
}

export const EVOLUTION_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
] as const

function globalKey(): string {
  const k = process.env.EVOLUTION_API_KEY
  if (!k) throw new EvolutionApiError('EVOLUTION_API_KEY não configurada', 500)
  return k
}

function toQr(q: Record<string, unknown> | null | undefined): EvolutionQr {
  return {
    base64: typeof q?.base64 === 'string' ? q.base64 : null,
    code: typeof q?.code === 'string' ? q.code : null,
    pairingCode: typeof q?.pairingCode === 'string' && q.pairingCode !== 'None' ? q.pairingCode : null,
  }
}

export async function createInstance(args: {
  instanceName: string
  webhookUrl: string
  webhookSecret: string
}): Promise<{ instanceToken: string; qr: EvolutionQr }> {
  const data = await evo<{
    hash?: unknown
    qrcode?: Record<string, unknown>
  }>('/instance/create', {
    method: 'POST',
    apikey: globalKey(),
    body: {
      instanceName: args.instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      rejectCall: false,
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      webhook: {
        url: args.webhookUrl,
        byEvents: false,
        base64: true,
        headers: { 'x-wacrm-secret': args.webhookSecret },
        events: [...EVOLUTION_EVENTS],
      },
    },
  })
  const hash = data.hash
  const instanceToken =
    typeof hash === 'string' ? hash : ((hash as { apikey?: string } | undefined)?.apikey ?? '')
  if (!instanceToken) throw new EvolutionApiError('A Evolution não devolveu a chave da instância', 502)
  return { instanceToken, qr: toQr(data.qrcode) }
}

export async function connectInstance(instanceName: string): Promise<EvolutionQr> {
  const data = await evo<Record<string, unknown>>(
    `/instance/connect/${encodeURIComponent(instanceName)}`,
    { apikey: globalKey() },
  )
  return toQr(data)
}

export type EvolutionState = 'open' | 'connecting' | 'close' | 'unknown'

export async function getConnectionState(instanceName: string): Promise<EvolutionState> {
  try {
    const data = await evo<{ instance?: { state?: string }; state?: string }>(
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
      { apikey: globalKey() },
    )
    const s = data.instance?.state ?? data.state
    return s === 'open' || s === 'connecting' || s === 'close' ? s : 'unknown'
  } catch (err) {
    if (err instanceof EvolutionApiError && err.status === 404) return 'close'
    throw err
  }
}

export async function instanceExists(instanceName: string): Promise<boolean> {
  try {
    await evo(`/instance/connectionState/${encodeURIComponent(instanceName)}`, { apikey: globalKey() })
    return true
  } catch (err) {
    if (err instanceof EvolutionApiError && err.status === 404) return false
    throw err
  }
}

export async function logoutInstance(instanceName: string): Promise<void> {
  try {
    await evo(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: 'DELETE', apikey: globalKey() })
  } catch (err) {
    if (!(err instanceof EvolutionApiError) || (err.status !== 404 && err.status !== 400)) throw err
  }
}

export async function deleteInstance(instanceName: string): Promise<void> {
  try {
    await evo(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: 'DELETE', apikey: globalKey() })
  } catch (err) {
    if (!(err instanceof EvolutionApiError) || err.status !== 404) throw err
  }
}


/**
 * A Evolution responde 500 com mensagens internas quando a instância não está conectada.
 * Troca por um aviso claro para quem está usando o CRM.
 */
async function explainSendFailure(instance: string, err: unknown): Promise<never> {
  if (err instanceof EvolutionApiError && err.status >= 500) {
    try {
      if ((await getConnectionState(instance)) !== 'open') {
        throw new EvolutionApiError(
          'WhatsApp desconectado. Leia o QR code novamente em Configurações > WhatsApp.',
          503,
        )
      }
    } catch (inner) {
      if (inner instanceof EvolutionApiError && inner.status === 503) throw inner
    }
  }
  throw err
}

// ------------------------------------------------------------
// Envio (chave da instância)
// ------------------------------------------------------------
interface SendBase {
  /** `phone_number_id` do whatsapp_config, com o prefixo evo_. */
  phoneNumberId: string
  /** Chave da instância, já descriptografada. */
  accessToken: string
  /** Telefone só com dígitos e DDI. */
  to: string
}

/**
 * Ids das mensagens que o próprio CRM enviou. A Evolution reenvia cada uma delas no webhook como
 * `fromMe`; sem esta lista o webhook poderia gravar a mensagem antes do CRM e o envio falharia
 * por duplicidade, ou gravaria um texto genérico no lugar da mídia.
 */
export function wasSentByCrm(id: string): boolean {
  const g = globalThis as unknown as { __evoSent?: Map<string, number> }
  const hit = g.__evoSent?.get(id)
  return !!hit && hit > Date.now()
}

function rememberSent(id: string): void {
  const g = globalThis as unknown as { __evoSent?: Map<string, number> }
  g.__evoSent ??= new Map()
  const now = Date.now()
  for (const [k, v] of g.__evoSent) if (v < now) g.__evoSent.delete(k)
  g.__evoSent.set(id, now + 10 * 60_000)
}

function messageIdOf(data: unknown): string {
  const id = (data as { key?: { id?: string } } | null)?.key?.id
  if (!id) throw new EvolutionApiError('A Evolution não devolveu o id da mensagem', 502)
  rememberSent(id)
  return id
}

export async function evoSendText(
  args: SendBase & { text: string; contextMessageId?: string },
): Promise<{ messageId: string }> {
  const instance = instanceFromPhoneId(args.phoneNumberId)
  await pace(instance)
  const body: Record<string, unknown> = { number: args.to, text: args.text }
  if (args.contextMessageId) body.quoted = { key: { id: args.contextMessageId } }
  const data = await evo(`/message/sendText/${encodeURIComponent(instance)}`, {
    method: 'POST',
    apikey: args.accessToken,
    body,
  }).catch((err) => explainSendFailure(instance, err))
  return { messageId: messageIdOf(data) }
}

export type EvoMediaKind = 'image' | 'video' | 'document' | 'audio'

function guessMime(kind: EvoMediaKind, link: string, filename?: string): string | undefined {
  const name = (filename || link.split('?')[0]).toLowerCase()
  if (kind === 'image') return name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  if (kind === 'video') return 'video/mp4'
  if (kind === 'audio') return name.endsWith('.mp3') ? 'audio/mpeg' : 'audio/ogg; codecs=opus'
  if (name.endsWith('.pdf')) return 'application/pdf'
  return undefined
}

const MEDIA_MAX_BYTES = 16 * 1024 * 1024

/**
 * Baixa o arquivo no servidor do CRM e devolve em base64. A Evolution muitas vezes não consegue
 * abrir a URL (em teste local o armazenamento está em localhost, que para o container dela é
 * ela mesma), então mandamos o conteúdo em vez do endereço. Se o download falhar, cai para a URL.
 */
async function fetchAsBase64(link: string): Promise<{ base64: string; mime: string | null } | null> {
  try {
    const res = await fetch(link, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return null
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MEDIA_MAX_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MEDIA_MAX_BYTES) return null
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim() || null
    return { base64: buf.toString('base64'), mime }
  } catch {
    return null
  }
}

export async function evoSendMedia(
  args: SendBase & {
    kind: EvoMediaKind
    link: string
    caption?: string
    filename?: string
    contextMessageId?: string
  },
): Promise<{ messageId: string }> {
  const instance = instanceFromPhoneId(args.phoneNumberId)
  await pace(instance)
  const file = await fetchAsBase64(args.link)
  if (args.kind === 'audio') {
    const data = await evo(`/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`, {
      method: 'POST',
      apikey: args.accessToken,
      body: { number: args.to, audio: file?.base64 ?? args.link },
    }).catch((err) => explainSendFailure(instance, err))
    return { messageId: messageIdOf(data) }
  }
  const body: Record<string, unknown> = {
    number: args.to,
    mediatype: args.kind,
    media: file?.base64 ?? args.link,
    caption: args.caption ?? '',
    fileName: args.filename || args.link.split('?')[0].split('/').pop() || 'arquivo',
  }
  const mime = (file?.mime && file.mime !== 'application/octet-stream' ? file.mime : null) ?? guessMime(args.kind, args.link, args.filename)
  if (mime) body.mimetype = mime
  if (args.contextMessageId) body.quoted = { key: { id: args.contextMessageId } }
  const data = await evo(`/message/sendMedia/${encodeURIComponent(instance)}`, {
    method: 'POST',
    apikey: args.accessToken,
    body,
  }).catch((err) => explainSendFailure(instance, err))
  return { messageId: messageIdOf(data) }
}

export async function evoSendReaction(
  args: SendBase & { targetMessageId: string; emoji: string },
): Promise<{ messageId: string }> {
  const instance = instanceFromPhoneId(args.phoneNumberId)
  const data = await evo(`/message/sendReaction/${encodeURIComponent(instance)}`, {
    method: 'POST',
    apikey: args.accessToken,
    body: {
      key: { remoteJid: `${args.to}@s.whatsapp.net`, fromMe: false, id: args.targetMessageId },
      reaction: args.emoji,
    },
  })
  return { messageId: (data as { key?: { id?: string } })?.key?.id ?? args.targetMessageId }
}

/**
 * Mensagens interativas (botões e listas) não são confiáveis fora da API oficial.
 * Vira texto numerado; o cliente responde digitando.
 */
export function interactiveToText(p: {
  header?: string
  body: string
  footer?: string
  options: string[]
}): string {
  const lines = [p.header, p.body, '', ...p.options.map((o, i) => `${i + 1}. ${o}`), p.footer, '', 'Responda com o número da opção.']
  return lines.filter((l) => l !== undefined && l !== null).join('\n')
}

// ------------------------------------------------------------
// Mídia recebida: o webhook da Evolution traz o arquivo em base64.
// Guardamos por alguns minutos em memória (compartilhada entre as
// rotas via globalThis) para o espelhamento existente baixar.
// ------------------------------------------------------------
interface CachedMedia {
  buffer: Buffer
  mime: string
  expires: number
}

function mediaCache(): Map<string, CachedMedia> {
  const g = globalThis as unknown as { __evoMedia?: Map<string, CachedMedia> }
  g.__evoMedia ??= new Map()
  return g.__evoMedia
}

export const EVO_MEDIA_ID_PREFIX = 'evo:'

export function putEvolutionMedia(id: string, buffer: Buffer, mime: string): void {
  const cache = mediaCache()
  const now = Date.now()
  for (const [k, v] of cache) if (v.expires < now) cache.delete(k)
  cache.set(id, { buffer, mime, expires: now + 10 * 60_000 })
}

export function getEvolutionMedia(id: string): { buffer: Buffer; mime: string } | null {
  const hit = mediaCache().get(id)
  return hit && hit.expires > Date.now() ? { buffer: hit.buffer, mime: hit.mime } : null
}
