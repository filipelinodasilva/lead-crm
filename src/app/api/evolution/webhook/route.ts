import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import { parseAppSecrets } from '@/lib/whatsapp/webhook-signature'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { phoneIdFromInstance, putEvolutionMedia, wasSentByCrm } from '@/lib/whatsapp/evolution-api'
import {
  normalizeEvolutionEvent,
  secretMatches,
  statusToMetaEnvelope,
  toMetaEnvelope,
  type NormalizedMessage,
} from '@/lib/whatsapp/evolution-webhook'

/**
 * Webhook da Evolution API.
 *
 * A Evolution não assina as chamadas como a Meta. A autenticação é o cabeçalho
 * `x-wacrm-secret`, configurado na criação da instância. Mensagens e status são convertidos
 * para o envelope da Meta e entregues ao webhook oficial (`/api/whatsapp/webhook`) assinado
 * com o META_APP_SECRET, assim todo o pipeline existente roda sem alteração.
 */
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function admin(): any {
  if (!_admin) {
    _admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  }
  return _admin
}

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get('x-wacrm-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const raw = await readCappedBody(request)
  if (raw === null) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  after(async () => {
    try {
      await handle(body)
    } catch (error) {
      console.error('[evolution-webhook]', error)
    }
  })
  return NextResponse.json({ status: 'received' })
}

async function handle(body: unknown) {
  const ev = normalizeEvolutionEvent(body)
  if (ev.kind === 'ignore') return

  const phoneNumberId = phoneIdFromInstance(ev.instance)
  const { data: config } = await admin()
    .from('whatsapp_config')
    .select('account_id, user_id, status')
    .eq('phone_number_id', phoneNumberId)
    .eq('provider', 'evolution')
    .maybeSingle()
  if (!config) {
    console.warn('[evolution-webhook] instância sem configuração:', ev.instance)
    return
  }

  if (ev.kind === 'connection') {
    const connected = ev.state === 'open'
    await admin()
      .from('whatsapp_config')
      .update({
        status: connected ? 'connected' : 'disconnected',
        connected_at: connected ? new Date().toISOString() : null,
      })
      .eq('account_id', config.account_id)
      .eq('phone_number_id', phoneNumberId)
    return
  }

  if (ev.kind === 'status') {
    await forward(statusToMetaEnvelope(ev, phoneNumberId))
    return
  }

  if (ev.fromMe) {
    // Eco de uma mensagem que o próprio CRM enviou: já é gravada pelo envio.
    if (wasSentByCrm(ev.messageId)) return
    await recordSentFromPhone(config.account_id, ev)
    return
  }

  if (ev.media) {
    putEvolutionMedia(`evo:${ev.messageId}`, Buffer.from(ev.media.base64, 'base64'), ev.media.mime)
  }
  await forward(toMetaEnvelope(ev, phoneNumberId))
}

/** Entrega o envelope ao webhook oficial, assinado como a Meta assinaria. */
async function forward(envelope: unknown) {
  const secret = parseAppSecrets(process.env.META_APP_SECRET)[0]
  if (!secret) {
    console.error('[evolution-webhook] META_APP_SECRET ausente: nada a entregar')
    return
  }
  const raw = JSON.stringify(envelope)
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const port = process.env.PORT || '3000'
  const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body: raw,
  })
  if (!res.ok) console.error('[evolution-webhook] webhook interno respondeu', res.status)
}

/**
 * Mensagem que o atendente digitou direto no celular: registra na conversa como enviada.
 * Não cria contato nem conversa; só acompanha uma conversa que já existe.
 */
async function recordSentFromPhone(accountId: string, ev: NormalizedMessage) {
  const contact = await findExistingContact(admin(), accountId, ev.phone)
  if (!contact) return
  const { data: conv } = await admin()
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (!conv) return

  // O eco de um envio do CRM pode chegar antes de o envio ser registrado (e em outro processo).
  // Espera um pouco e confere se a mensagem já existe antes de gravar.
  await new Promise((r) => setTimeout(r, 5000))
  const { data: already } = await admin()
    .from('messages')
    .select('id')
    .eq('conversation_id', conv.id)
    .eq('message_id', ev.messageId)
    .limit(1)
  if (already && already.length > 0) return

  const type = String(ev.metaMessage.type ?? 'text')
  const text = ev.text ?? (type === 'text' ? null : `[${type} enviado pelo celular]`)
  const createdAt = new Date(Number(ev.timestamp) * 1000).toISOString()
  const { data: inserted } = await admin()
    .from('messages')
    .upsert(
      {
        conversation_id: conv.id,
        sender_type: 'agent',
        content_type: 'text',
        content_text: text,
        message_id: ev.messageId,
        status: 'sent',
        created_at: createdAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id')
  if (inserted && inserted.length > 0) {
    await admin()
      .from('conversations')
      .update({ last_message_text: text ?? '', last_message_at: createdAt, updated_at: new Date().toISOString() })
      .eq('id', conv.id)
  }
}
