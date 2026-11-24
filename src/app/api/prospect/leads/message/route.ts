import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { sendLeadMessage } from '@/lib/prospect/message';
import { ProspectError } from '@/lib/prospect/types';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { SendMessageError } from '@/lib/whatsapp/send-message';

export const maxDuration = 60;

/**
 * POST { leadId, text, connection_id? }
 * Envia uma mensagem de texto livre ao lead pelo número conectado por QR code, cria o
 * contato e a conversa se faltarem e liga o lead ao contato. Recusa quem pediu SAIR.
 */
export async function POST(req: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await req.json().catch(() => null)) as {
      leadId?: unknown;
      text?: unknown;
      connection_id?: unknown;
    } | null;
    if (typeof body?.leadId !== 'string' || typeof body?.text !== 'string') {
      throw new ProspectError('Informe o lead e a mensagem.');
    }

    const result = await sendLeadMessage(
      { db: supabaseAdmin(), userDb: supabase, accountId, userId },
      {
        leadId: body.leadId,
        text: body.text,
        connectionId:
          typeof body.connection_id === 'string' ? body.connection_id : null,
      }
    );
    return NextResponse.json({
      conversation_id: result.conversationId,
      contact_id: result.contactId,
      message_id: result.messageId,
    });
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      );
    }
    return prospectErrorResponse(err);
  }
}
