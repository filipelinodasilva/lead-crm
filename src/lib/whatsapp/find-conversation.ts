// Procura a conversa de um telefone SEM criar nada. É o que o botão "Abrir conversa"
// usa: se já existe conversa, vai direto para ela; se não, o botão abre a janela de
// nova conversa (que só cria a conversa quando a primeira mensagem sai), para não
// encher a caixa de entrada com conversas vazias.

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact } from '@/lib/contacts/dedupe';
import { normalizeBrazilPhone } from './new-conversation';

export interface FoundConversation {
  /** Telefone normalizado em E.164, ou null se a entrada não parecia telefone. */
  phone: string | null;
  contactId: string | null;
  conversationId: string | null;
}

export async function findConversationByPhone(
  db: SupabaseClient,
  accountId: string,
  rawPhone: string
): Promise<FoundConversation> {
  const phone = normalizeBrazilPhone(rawPhone);
  if (!phone) return { phone: null, contactId: null, conversationId: null };

  const contact = await findExistingContact(db, accountId, phone);
  if (!contact) return { phone, contactId: null, conversationId: null };

  // Uma conversa por (conta, contato). Se houver duplicadas antigas, vale a mais antiga,
  // como no resto do sistema.
  const { data } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .order('created_at', { ascending: true })
    .limit(1);

  return {
    phone,
    contactId: contact.id,
    conversationId: (data?.[0]?.id as string | undefined) ?? null,
  };
}
