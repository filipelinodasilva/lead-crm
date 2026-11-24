// Integration test for "open conversation" and "send from the lead panel",
// against a LOCAL Supabase. The WhatsApp itself is replaced by a fake: nothing leaves the machine.
// Skipped unless PROSPECT_INTEGRATION=1 (it needs the local stack and .env.local):
//   PROSPECT_INTEGRATION=1 npx vitest run src/lib/prospect/whatsapp-actions.int.test.ts
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findConversationByPhone } from '@/lib/whatsapp/find-conversation';
import {
  sendLeadMessage,
  type LeadMessageDeps,
} from './message';

const run = process.env.PROSPECT_INTEGRATION === '1';

function loadEnv(): Record<string, string> {
  const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
}

describe.skipIf(!run)('whatsapp actions (local Supabase)', () => {
  let db: SupabaseClient;
  let userId = '';
  let accountId = '';
  let connectionId = '';

  const sent: { conversationId: string; text: string }[] = [];
  const deps = (over: Partial<LeadMessageDeps> = {}): LeadMessageDeps => ({
    getConnection: async (d, acc, id) => {
      const q = d.from('whatsapp_config').select('*').eq('account_id', acc);
      const { data } = id
        ? await q.eq('id', id).maybeSingle()
        : await q.eq('is_default', true).maybeSingle();
      return data as never;
    },
    isConnected: async () => true,
    send: async (_d, _a, { conversationId, text }) => {
      sent.push({ conversationId, text });
      return { messageId: 'fake-msg' };
    },
    ...over,
  });

  async function makeLead(name: string, phone: string | null) {
    const { data } = await db
      .from('prospect_leads')
      .insert({
        account_id: accountId,
        provider: 'gosom',
        place_id: `int-${randomBytes(6).toString('hex')}`,
        name,
        phone,
        phone_e164: phone,
        phone_kind: 'mobile',
        review_count: 3,
      })
      .select('id')
      .single();
    return data!.id as string;
  }

  const ctx = () => ({ db, userDb: db, accountId, userId });

  beforeAll(async () => {
    const env = loadEnv();
    db = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data: user } = await db.auth.admin.createUser({
      email: `cp-wa-${randomBytes(4).toString('hex')}@example.com`,
      password: randomBytes(12).toString('hex'),
      email_confirm: true,
    });
    userId = user.user!.id;
    const { data: profile } = await db
      .from('profiles')
      .select('account_id')
      .eq('user_id', userId)
      .single();
    accountId = profile!.account_id;
    const { data: conn } = await db
      .from('whatsapp_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        provider: 'evolution',
        phone_number_id: 'evo_int_test',
        access_token: 'x',
        status: 'connected',
        is_default: true,
        name: 'int',
      })
      .select('id')
      .single();
    connectionId = conn!.id;
  });

  afterAll(async () => {
    if (!run) return;
    await db.from('accounts').delete().eq('id', accountId);
    await db.auth.admin.deleteUser(userId);
  });

  describe('findConversationByPhone', () => {
    it('finds nothing and creates nothing for an unknown number', async () => {
      const r = await findConversationByPhone(db, accountId, '(31) 98888-0001');
      expect(r.phone).toBe('+5531988880001');
      expect(r.contactId).toBeNull();
      expect(r.conversationId).toBeNull();
      const { count } = await db
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId);
      expect(count).toBe(0);
    });

    it('returns the contact but no conversation when only the contact exists', async () => {
      await db.from('contacts').insert({
        account_id: accountId,
        user_id: userId,
        phone: '+5531988880002',
        name: 'Só contato',
      });
      const r = await findConversationByPhone(db, accountId, '+5531988880002');
      expect(r.contactId).toBeTruthy();
      expect(r.conversationId).toBeNull();
    });

    it('returns the conversation when one exists, from a number typed with a mask', async () => {
      const { data: c } = await db
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: userId,
          phone: '+5531988880003',
          name: 'Com conversa',
        })
        .select('id')
        .single();
      const { data: conv } = await db
        .from('conversations')
        .insert({ account_id: accountId, user_id: userId, contact_id: c!.id })
        .select('id')
        .single();
      const r = await findConversationByPhone(db, accountId, '(31) 98888-0003');
      expect(r.conversationId).toBe(conv!.id);
      expect(r.contactId).toBe(c!.id);
    });

    it('returns a null phone for input that is not a phone', async () => {
      const r = await findConversationByPhone(db, accountId, 'abc');
      expect(r.phone).toBeNull();
    });
  });

  describe('sendLeadMessage', () => {
    it('sends, creates the contact and conversation, and links the lead to the contact', async () => {
      sent.length = 0;
      const leadId = await makeLead('Clínica Alfa', '+5531977770001');
      const r = await sendLeadMessage(
        ctx(),
        { leadId, text: '  Olá, tudo bem?  ' },
        deps()
      );
      expect(r.conversationId).toBeTruthy();
      expect(sent).toEqual([
        { conversationId: r.conversationId, text: 'Olá, tudo bem?' },
      ]);
      const { data: lead } = await db
        .from('prospect_leads')
        .select('contact_id')
        .eq('id', leadId)
        .single();
      expect(lead?.contact_id).toBe(r.contactId);
      const { data: conv } = await db
        .from('conversations')
        .select('contact_id, whatsapp_config_id')
        .eq('id', r.conversationId)
        .single();
      expect(conv?.contact_id).toBe(r.contactId);
      expect(conv?.whatsapp_config_id).toBe(connectionId);
    });

    it('refuses a number that asked to stop (SAIR) and sends nothing', async () => {
      sent.length = 0;
      const leadId = await makeLead('Clínica Beta', '+5531977770002');
      await db.from('prospect_optouts').insert({
        account_id: accountId,
        phone_normalized: '5531977770002',
      });
      await expect(
        sendLeadMessage(ctx(), { leadId, text: 'Oi' }, deps())
      ).rejects.toThrow(/SAIR/);
      expect(sent).toHaveLength(0);
      const { data: lead } = await db
        .from('prospect_leads')
        .select('contact_id')
        .eq('id', leadId)
        .single();
      expect(lead?.contact_id).toBeNull();
    });

    it('refuses a lead with no phone', async () => {
      const leadId = await makeLead('Sem fone', null);
      await expect(
        sendLeadMessage(ctx(), { leadId, text: 'Oi' }, deps())
      ).rejects.toThrow(/não tem telefone/);
    });

    it('refuses empty or oversized text before touching anything', async () => {
      const leadId = await makeLead('Clínica Gama', '+5531977770003');
      await expect(
        sendLeadMessage(ctx(), { leadId, text: '   ' }, deps())
      ).rejects.toThrow(/Escreva/);
      await expect(
        sendLeadMessage(ctx(), { leadId, text: 'a'.repeat(4097) }, deps())
      ).rejects.toThrow(/4096/);
    });

    it('refuses when the WhatsApp is disconnected and creates no conversation', async () => {
      const leadId = await makeLead('Clínica Delta', '+5531977770004');
      await expect(
        sendLeadMessage(
          ctx(),
          { leadId, text: 'Oi' },
          deps({ isConnected: async () => false })
        )
      ).rejects.toThrow(/desconectado/);
      const found = await findConversationByPhone(db, accountId, '+5531977770004');
      expect(found.conversationId).toBeNull();
    });

    it('refuses an official-API connection (first message needs a template)', async () => {
      const leadId = await makeLead('Clínica Épsilon', '+5531977770005');
      await expect(
        sendLeadMessage(
          ctx(),
          { leadId, text: 'Oi' },
          deps({
            getConnection: async () =>
              ({ id: connectionId, provider: 'meta' }) as never,
          })
        )
      ).rejects.toThrow(/QR code/);
    });

    it('answers not found for a lead of another account', async () => {
      await expect(
        sendLeadMessage(
          ctx(),
          { leadId: '00000000-0000-4000-8000-000000000000', text: 'Oi' },
          deps()
        )
      ).rejects.toThrow(/não encontrado/);
    });
  });
});
