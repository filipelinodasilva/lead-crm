import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import { normalizeBrazilPhone } from '@/lib/whatsapp/new-conversation'
import { resolveConnection } from '@/lib/whatsapp/connections'
import { getConnectionState, instanceFromPhoneId } from '@/lib/whatsapp/evolution-api'

/**
 * POST /api/whatsapp/new-conversation
 *
 * Inicia uma conversa com um número novo (ou existente) enviando uma mensagem de texto
 * livre, sem modelo. Só vale para contas conectadas por QR code (Evolution): na API oficial
 * da Meta a primeira mensagem exige modelo aprovado.
 *
 * Body: { phone: string, name?: string, text: string }
 * O telefone aceita dígitos com ou sem DDI; sem DDI assume Brasil (+55).
 */

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as {
      phone?: unknown
      name?: unknown
      text?: unknown
      connection_id?: unknown
    } | null

    // Conexão escolhida; sem escolha, a padrão. Precisa ser uma conexão por QR code.
    const config = await resolveConnection(supabase, accountId, {
      connectionId: typeof body?.connection_id === 'string' ? body.connection_id : null,
    })
    if (!config) {
      return NextResponse.json({ error: 'Conecte o WhatsApp em Configurações antes de enviar.' }, { status: 400 })
    }
    if (config.provider !== 'evolution') {
      return NextResponse.json(
        { error: 'A primeira mensagem sem modelo só funciona com um número conectado por QR code. Escolha uma conexão QR.' },
        { status: 400 },
      )
    }

    const phone = typeof body?.phone === 'string' ? normalizeBrazilPhone(body.phone) : null
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null
    if (!phone) {
      return NextResponse.json({ error: 'Telefone inválido. Informe o DDD e o número.' }, { status: 400 })
    }
    if (!text) {
      return NextResponse.json({ error: 'Escreva a mensagem.' }, { status: 400 })
    }
    if (text.length > 4096) {
      return NextResponse.json({ error: 'A mensagem passa de 4096 caracteres.' }, { status: 400 })
    }

    // Confere a conexão antes de criar contato e conversa, para não deixar uma conversa vazia.
    if ((await getConnectionState(instanceFromPhoneId(config.phone_number_id as string))) !== 'open') {
      return NextResponse.json(
        { error: 'WhatsApp desconectado. Leia o QR code novamente em Configurações > WhatsApp.' },
        { status: 503 },
      )
    }

    const resolved = await resolveConversationByPhone(supabaseAdmin(), accountId, phone, name, config.id)
    const result = await sendMessageToConversation(supabase, accountId, {
      conversationId: resolved.conversationId,
      messageType: 'text',
      contentText: text,
      senderId: userId,
    })

    return NextResponse.json({
      conversation_id: resolved.conversationId,
      contact_id: resolved.contactId,
      contact_created: resolved.contactCreated,
      message_id: result.messageId,
    })
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
