/**
 * Normaliza os eventos do webhook da Evolution API (v2) para o formato interno do app.
 *
 * Mensagens recebidas viram o mesmo envelope que a Meta envia, para reaproveitar todo o
 * pipeline existente (contato, conversa, automações, fluxos, IA). Funções puras, testáveis.
 */

import crypto from 'node:crypto'

import { EVO_MEDIA_ID_PREFIX } from './evolution-api'

/** Segredo do cabeçalho x-wacrm-secret. Derivado da ENCRYPTION_KEY se não houver um próprio. */
export function evolutionWebhookSecret(): string {
  const own = process.env.EVOLUTION_WEBHOOK_SECRET
  if (own) return own
  const base = process.env.ENCRYPTION_KEY
  if (!base) throw new Error('ENCRYPTION_KEY ausente: não dá para derivar o segredo do webhook')
  return crypto.createHmac('sha256', base).update('wacrm-evolution-webhook').digest('hex')
}

export function secretMatches(received: string | null): boolean {
  if (!received) return false
  let expected: string
  try {
    expected = evolutionWebhookSecret()
  } catch {
    return false
  }
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

type Json = Record<string, unknown>

export interface InboundMedia {
  base64: string
  mime: string
  fileName?: string
}

export interface NormalizedMessage {
  kind: 'message'
  instance: string
  messageId: string
  fromMe: boolean
  phone: string
  pushName?: string
  /** Segundos desde 1970. */
  timestamp: string
  /** Mensagem no formato Meta (type + campo do tipo). */
  metaMessage: Record<string, unknown>
  /** Texto para registrar (usado nas mensagens enviadas pelo celular). */
  text: string | null
  media?: InboundMedia
}

export interface NormalizedStatus {
  kind: 'status'
  instance: string
  messageId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  phone: string
  timestamp: string
}

export interface NormalizedConnection {
  kind: 'connection'
  instance: string
  state: 'open' | 'connecting' | 'close'
}

export interface Ignored {
  kind: 'ignore'
  reason: string
}

export type NormalizedEvent = NormalizedMessage | NormalizedStatus | NormalizedConnection | Ignored

const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/**
 * Celular brasileiro antigo (DDD + 8 dígitos) ganha o 9 depois do DDD. O WhatsApp ainda entrega
 * alguns JIDs sem o 9, e sem isso o mesmo cliente viraria dois contatos (com e sem o 9).
 */
export function canonicalBrazilMobile(digits: string): string {
  return /^55\d{2}[6-9]\d{7}$/.test(digits) ? `${digits.slice(0, 4)}9${digits.slice(4)}` : digits
}

/** `5511999999999@s.whatsapp.net` → `5511999999999`. Grupos, status e LID sem número viram null. */
export function phoneFromJid(jid: string | undefined, altJid?: string): string | null {
  const pick = (j?: string) => {
    if (!j) return null
    if (j.endsWith('@g.us') || j.startsWith('status@') || j.endsWith('@broadcast') || j.endsWith('@newsletter')) return null
    if (!j.endsWith('@s.whatsapp.net')) return null
    const digits = j.split('@')[0].split(':')[0].replace(/\D/g, '')
    return digits.length >= 8 ? canonicalBrazilMobile(digits) : null
  }
  return pick(jid) ?? pick(altJid)
}

/** Remove os envoltórios de mensagem temporária, visualização única e documento com legenda. */
function unwrap(message: Json): Json {
  let current = message
  for (let i = 0; i < 4; i++) {
    const inner =
      obj(obj(current.ephemeralMessage)?.message) ??
      obj(obj(current.viewOnceMessage)?.message) ??
      obj(obj(current.viewOnceMessageV2)?.message) ??
      obj(obj(current.documentWithCaptionMessage)?.message)
    if (!inner) break
    current = inner
  }
  return current
}

function mapStatus(s: unknown): NormalizedStatus['status'] | null {
  switch (String(s ?? '').toUpperCase()) {
    case 'SERVER_ACK':
    case 'SENT':
      return 'sent'
    case 'DELIVERY_ACK':
    case 'DELIVERED':
      return 'delivered'
    case 'READ':
    case 'PLAYED':
      return 'read'
    case 'ERROR':
    case 'FAILED':
      return 'failed'
    default:
      return null
  }
}

export function normalizeEvolutionEvent(payload: unknown): NormalizedEvent {
  const root = obj(payload)
  if (!root) return { kind: 'ignore', reason: 'payload inválido' }
  const event = String(root.event ?? '').toLowerCase().replace(/_/g, '.')
  const instance = str(root.instance) ?? ''
  const data = obj(root.data) ?? {}

  if (event === 'connection.update') {
    const s = String(data.state ?? '')
    if (s === 'open' || s === 'connecting' || s === 'close') return { kind: 'connection', instance, state: s }
    return { kind: 'ignore', reason: `estado de conexão desconhecido: ${s}` }
  }

  if (event === 'messages.update') {
    const status = mapStatus(data.status)
    const messageId = str(data.keyId) ?? str(obj(data.key)?.id)
    const phone = phoneFromJid(str(data.remoteJid) ?? str(obj(data.key)?.remoteJid), str(obj(data.key)?.remoteJidAlt))
    if (!status || !messageId || !phone) return { kind: 'ignore', reason: 'atualização sem dados suficientes' }
    // Status só importa para mensagens que NÓS enviamos.
    const fromMe = data.fromMe ?? obj(data.key)?.fromMe
    if (fromMe === false) return { kind: 'ignore', reason: 'status de mensagem recebida' }
    return { kind: 'status', instance, messageId, status, phone, timestamp: String(Math.floor(Date.now() / 1000)) }
  }

  if (event === 'messages.upsert') {
    const key = obj(data.key)
    const messageId = str(key?.id)
    const phone = phoneFromJid(str(key?.remoteJid), str(key?.remoteJidAlt) ?? str(data.senderPn))
    if (!key || !messageId) return { kind: 'ignore', reason: 'mensagem sem id' }
    if (!phone) return { kind: 'ignore', reason: 'grupo, status ou contato sem número' }
    const rawMessage = obj(data.message)
    if (!rawMessage) return { kind: 'ignore', reason: 'mensagem sem conteúdo' }
    const base64 = str(rawMessage.base64) ?? str(data.base64)
    const m = unwrap(rawMessage)
    const fromMe = key.fromMe === true
    const ts = String(
      typeof data.messageTimestamp === 'number' || typeof data.messageTimestamp === 'string'
        ? Number(data.messageTimestamp) || Math.floor(Date.now() / 1000)
        : Math.floor(Date.now() / 1000),
    )
    const base = { kind: 'message' as const, instance, messageId, fromMe, phone, pushName: str(data.pushName), timestamp: ts }
    const mediaId = `${EVO_MEDIA_ID_PREFIX}${messageId}`

    const textBody = str(m.conversation) ?? str(obj(m.extendedTextMessage)?.text)
    if (textBody) {
      return { ...base, metaMessage: { id: messageId, from: phone, timestamp: ts, type: 'text', text: { body: textBody } }, text: textBody }
    }
    const reaction = obj(m.reactionMessage)
    if (reaction) {
      const target = str(obj(reaction.key)?.id)
      if (!target) return { kind: 'ignore', reason: 'reação sem alvo' }
      return { ...base, metaMessage: { id: messageId, from: phone, timestamp: ts, type: 'reaction', reaction: { message_id: target, emoji: str(reaction.text) ?? '' } }, text: null }
    }
    const mediaTypes: Array<[string, 'image' | 'video' | 'audio' | 'document' | 'sticker']> = [
      ['imageMessage', 'image'],
      ['videoMessage', 'video'],
      ['audioMessage', 'audio'],
      ['documentMessage', 'document'],
      ['stickerMessage', 'sticker'],
    ]
    for (const [field, type] of mediaTypes) {
      const node = obj(m[field])
      if (!node) continue
      const mime = (str(node.mimetype) ?? 'application/octet-stream').split(';')[0].trim()
      const caption = str(node.caption)
      const fileName = str(node.fileName)
      const entry: Json = { id: mediaId, mime_type: mime }
      if (caption && type !== 'audio' && type !== 'sticker') entry.caption = caption
      if (type === 'document' && fileName) entry.filename = fileName
      return {
        ...base,
        metaMessage: { id: messageId, from: phone, timestamp: ts, type, [type]: entry },
        text: caption ?? null,
        media: base64 ? { base64, mime, fileName } : undefined,
      }
    }
    const loc = obj(m.locationMessage)
    if (loc && typeof loc.degreesLatitude === 'number' && typeof loc.degreesLongitude === 'number') {
      return {
        ...base,
        metaMessage: {
          id: messageId, from: phone, timestamp: ts, type: 'location',
          location: { latitude: loc.degreesLatitude, longitude: loc.degreesLongitude, name: str(loc.name), address: str(loc.address) },
        },
        text: null,
      }
    }
    // Respostas a botões/listas que a Evolution entrega como texto.
    const reply =
      str(obj(m.buttonsResponseMessage)?.selectedDisplayText) ??
      str(obj(m.listResponseMessage)?.title) ??
      str(obj(m.templateButtonReplyMessage)?.selectedDisplayText)
    if (reply) {
      return { ...base, metaMessage: { id: messageId, from: phone, timestamp: ts, type: 'text', text: { body: reply } }, text: reply }
    }
    return { kind: 'ignore', reason: 'tipo de mensagem não suportado' }
  }

  return { kind: 'ignore', reason: `evento ${event || 'desconhecido'}` }
}

/** Envelope no formato da Meta para o pipeline de mensagens recebidas. */
export function toMetaEnvelope(msg: NormalizedMessage, phoneNumberId: string): Json {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'evolution',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '', phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: msg.pushName }, wa_id: msg.phone }],
              messages: [msg.metaMessage],
            },
          },
        ],
      },
    ],
  }
}

/** Envelope de status no formato da Meta. */
export function statusToMetaEnvelope(st: NormalizedStatus, phoneNumberId: string): Json {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'evolution',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '', phone_number_id: phoneNumberId },
              statuses: [{ id: st.messageId, status: st.status, timestamp: st.timestamp, recipient_id: st.phone }],
            },
          },
        ],
      },
    ],
  }
}
