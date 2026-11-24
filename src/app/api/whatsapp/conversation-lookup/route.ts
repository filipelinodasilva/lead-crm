import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { findConversationByPhone } from '@/lib/whatsapp/find-conversation'

/**
 * GET /api/whatsapp/conversation-lookup?phone=...
 *
 * Diz se já existe conversa com este telefone, sem criar nada. Usado pelo botão
 * "Abrir conversa": com conversa, vai para a caixa de entrada; sem conversa, abre a
 * janela de nova conversa.
 * Resposta: { phone, contact_id, conversation_id } (os dois ids podem ser null).
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const phone = new URL(request.url).searchParams.get('phone') ?? ''
    if (!phone.trim()) {
      return NextResponse.json({ error: 'Informe o telefone.' }, { status: 400 })
    }
    const found = await findConversationByPhone(supabase, accountId, phone)
    if (!found.phone) {
      return NextResponse.json({ error: 'Telefone inválido.' }, { status: 400 })
    }
    return NextResponse.json({
      phone: found.phone,
      contact_id: found.contactId,
      conversation_id: found.conversationId,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
