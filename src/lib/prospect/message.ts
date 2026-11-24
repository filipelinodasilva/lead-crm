// Envio manual de uma mensagem a um lead pela própria plataforma (gaveta do lead).
// Mesmas travas do envio em massa que valem aqui: lista de bloqueio (SAIR) e número
// conectado por QR code. Além de enviar, liga o lead ao contato criado, para a gaveta
// achar o negócio do funil por esse contato.

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveConnection, type Connection } from '@/lib/whatsapp/connections';
import {
  getConnectionState,
  instanceFromPhoneId,
} from '@/lib/whatsapp/evolution-api';
import { waDigits } from '@/lib/whatsapp/links';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { ProspectError } from './types';

export const MAX_LEAD_MESSAGE = 4096;

export interface LeadMessageDeps {
  getConnection(
    db: SupabaseClient,
    accountId: string,
    connectionId: string | null
  ): Promise<Connection | null>;
  isConnected(connection: Connection): Promise<boolean>;
  send(
    db: SupabaseClient,
    accountId: string,
    args: { conversationId: string; text: string; userId: string }
  ): Promise<{ messageId: string | null }>;
}

export const defaultLeadMessageDeps: LeadMessageDeps = {
  getConnection: (db, accountId, connectionId) =>
    resolveConnection(db, accountId, { connectionId }),
  isConnected: async (c) =>
    (await getConnectionState(
      instanceFromPhoneId(c.phone_number_id as string)
    )) === 'open',
  send: async (db, accountId, { conversationId, text, userId }) => {
    const r = await sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: 'text',
      contentText: text,
      senderId: userId,
    });
    return { messageId: r.messageId ?? null };
  },
};

export interface SendLeadMessageResult {
  conversationId: string;
  contactId: string;
  messageId: string | null;
}

/**
 * `db` precisa conseguir criar contato e conversa (cliente de serviço);
 * `userDb` é o cliente do usuário, usado para gravar a mensagem com as permissões dele.
 */
export async function sendLeadMessage(
  ctx: {
    db: SupabaseClient;
    userDb: SupabaseClient;
    accountId: string;
    userId: string;
  },
  input: { leadId: string; text: string; connectionId?: string | null },
  deps: LeadMessageDeps = defaultLeadMessageDeps
): Promise<SendLeadMessageResult> {
  const text = input.text.trim();
  if (!text) throw new ProspectError('Escreva a mensagem.');
  if (text.length > MAX_LEAD_MESSAGE) {
    throw new ProspectError(`A mensagem passa de ${MAX_LEAD_MESSAGE} caracteres.`);
  }

  const { data: lead } = await ctx.userDb
    .from('prospect_leads')
    .select('id, name, phone_e164')
    .eq('id', input.leadId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!lead) throw new ProspectError('Lead não encontrado.', 404);

  const phone = lead.phone_e164 as string | null;
  const digits = waDigits(phone);
  if (!phone || !digits) {
    throw new ProspectError('Este lead não tem telefone.');
  }

  // Quem pediu para sair nunca mais recebe, nem por envio manual.
  const { data: blocked } = await ctx.userDb
    .from('prospect_optouts')
    .select('phone_normalized')
    .eq('account_id', ctx.accountId)
    .eq('phone_normalized', digits)
    .maybeSingle();
  if (blocked) {
    throw new ProspectError(
      'Este número pediu para não receber mais mensagens (SAIR). Não dá para enviar.'
    );
  }

  const connection = await deps.getConnection(
    ctx.userDb,
    ctx.accountId,
    input.connectionId ?? null
  );
  if (!connection) {
    throw new ProspectError('Conecte o WhatsApp em Configurações antes de enviar.');
  }
  if (connection.provider !== 'evolution') {
    throw new ProspectError(
      'A primeira mensagem sem modelo só funciona com um número conectado por QR code.'
    );
  }
  if (!(await deps.isConnected(connection))) {
    throw new ProspectError(
      'WhatsApp desconectado. Leia o QR code novamente em Configurações > WhatsApp.'
    );
  }

  const resolved = await resolveConversationByPhone(
    ctx.db,
    ctx.accountId,
    phone,
    lead.name as string,
    connection.id
  );
  const sent = await deps.send(ctx.userDb, ctx.accountId, {
    conversationId: resolved.conversationId,
    text,
    userId: ctx.userId,
  });

  // O lead passa a apontar para o contato criado (ou já existente).
  await ctx.userDb
    .from('prospect_leads')
    .update({ contact_id: resolved.contactId })
    .eq('id', input.leadId)
    .eq('account_id', ctx.accountId);

  return {
    conversationId: resolved.conversationId,
    contactId: resolved.contactId,
    messageId: sent.messageId,
  };
}
