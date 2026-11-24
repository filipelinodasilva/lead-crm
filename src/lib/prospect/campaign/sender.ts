import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getConnectionById } from '@/lib/whatsapp/connections';
import {
  getConnectionState,
  instanceFromPhoneId,
} from '@/lib/whatsapp/evolution-api';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import type { Campaign } from './types';

// How a campaign message leaves the system. Mode comes from PROSPECT_SENDER:
//   real (default)  sends through the campaign's WhatsApp connection
//   dry-run         pretends to send (tests and demos, nothing leaves the server)
//   fail            always fails (to test the error handling)

export type SenderMode = 'real' | 'dry-run' | 'fail';

export function senderMode(
  env: Record<string, string | undefined> = process.env
): SenderMode {
  const v = env.PROSPECT_SENDER;
  return v === 'dry-run' || v === 'fail' ? v : 'real';
}

export interface SendArgs {
  campaign: Campaign;
  contact: { id: string; name: string | null; phone: string };
  text: string;
  templateParams: string[];
}

export type Sender = (
  args: SendArgs
) => Promise<{ conversationId: string | null }>;

export class SendFailure extends Error {}

export const defaultSender: Sender = async ({
  campaign,
  contact,
  text,
  templateParams,
}) => {
  const mode = senderMode();
  if (mode === 'dry-run') return { conversationId: null };
  if (mode === 'fail')
    throw new SendFailure('Falha simulada (PROSPECT_SENDER=fail).');

  const admin = supabaseAdmin();
  const digits = contact.phone.replace(/\D/g, '');
  const resolved = await resolveConversationByPhone(
    admin,
    campaign.account_id,
    `+${digits}`,
    contact.name,
    campaign.connection_id
  );
  await sendMessageToConversation(admin, campaign.account_id, {
    conversationId: resolved.conversationId,
    senderId: campaign.created_by,
    ...(campaign.kind === 'template'
      ? {
          messageType: 'template',
          templateName: campaign.template_name,
          templateLanguage: campaign.template_language,
          templateParams,
        }
      : { messageType: 'text', contentText: text }),
  });
  return { conversationId: resolved.conversationId };
};

export type ConnectionCheck = 'ok' | 'missing' | 'disconnected';

/** Is the campaign's WhatsApp connection ready to send right now? */
export async function checkConnection(
  db: SupabaseClient,
  campaign: Pick<Campaign, 'account_id' | 'connection_id'>
): Promise<ConnectionCheck> {
  if (senderMode() !== 'real') return 'ok';
  const conn = campaign.connection_id
    ? await getConnectionById(db, campaign.account_id, campaign.connection_id)
    : null;
  if (!conn) return 'missing';
  if (conn.provider === 'evolution') {
    const state = await getConnectionState(
      instanceFromPhoneId(conn.phone_number_id)
    );
    return state === 'open' ? 'ok' : 'disconnected';
  }
  return conn.status === 'connected' ? 'ok' : 'disconnected';
}
