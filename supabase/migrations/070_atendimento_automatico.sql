-- ============================================================
-- 070_atendimento_automatico.sql — Atendimento automático (opcional)
--
-- Módulo novo, inspirado no Whaticket, que NÃO substitui fluxos,
-- automações nem o agente de IA: tudo vem desligado e cada empresa liga
-- o que quiser em Configurações > Atendimento.
--
--   accounts.attendance_automation  JSON com as chaves e textos (ausente = desligado)
--   departments  + greeting_message, schedule, out_of_hours_message
--   tickets      + estado do menu, pedido de avaliação e marcas "já feito"
--   attendance_outbox  mensagens a enviar por causa de ações na tela
--                      (assumir, transferir, encerrar, pedir avaliação)
-- Idempotente.
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS attendance_automation JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS greeting_message TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS out_of_hours_message TEXT NOT NULL DEFAULT '',
  -- {"days":[1,2,3,4,5],"start":"08:00","end":"18:00"}  (0 = domingo); vazio = sempre aberto
  ADD COLUMN IF NOT EXISTS schedule JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS triage_status TEXT CHECK (triage_status IN ('asked', 'done')),
  ADD COLUMN IF NOT EXISTS triage_attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS out_of_hours_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_transferred BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inactivity_closed BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS attendance_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('accept', 'transfer', 'close', 'rating')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_attendance_outbox_pending
  ON attendance_outbox(account_id, created_at) WHERE claimed_at IS NULL;
-- Só o servidor (service role) lê e escreve.
ALTER TABLE attendance_outbox ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Fila de saída: ações humanas na tela viram mensagem ao cliente
-- ============================================================
CREATE OR REPLACE FUNCTION public.attendance_render(p_text TEXT, p_conv conversations) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT replace(replace(replace(replace(COALESCE(p_text, ''),
    '{nome}', COALESCE((SELECT NULLIF(name, '') FROM contacts WHERE id = p_conv.contact_id), '')),
    '{atendente}', COALESCE((SELECT NULLIF(full_name, '') FROM profiles WHERE user_id = p_conv.assigned_agent_id), '')),
    '{setor}', COALESCE((SELECT name FROM departments WHERE id = p_conv.department_id), '')),
    '{ticket}', COALESCE(p_conv.ticket_number::text, ''));
$$;
ALTER FUNCTION public.attendance_render(TEXT, conversations) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attendance_render(TEXT, conversations) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.attendance_enqueue()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg JSONB;
  v_ticket tickets;
BEGIN
  -- só ações de pessoas na tela; mudanças do sistema (cliente voltando,
  -- tarefas agendadas) não disparam mensagem por aqui
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  -- troca do ponteiro de ticket não é ação
  IF NEW.current_ticket_id IS DISTINCT FROM OLD.current_ticket_id THEN RETURN NULL; END IF;
  SELECT attendance_automation INTO v_cfg FROM accounts WHERE id = NEW.account_id;
  IF v_cfg IS NULL OR v_cfg = '{}'::jsonb THEN RETURN NULL; END IF;
  SELECT * INTO v_ticket FROM tickets WHERE id = NEW.current_ticket_id;

  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    IF (v_cfg ->> 'rating_enabled') = 'true' AND NEW.assigned_agent_id IS NOT NULL THEN
      INSERT INTO attendance_outbox (account_id, conversation_id, ticket_id, kind, body)
      VALUES (NEW.account_id, NEW.id, NEW.current_ticket_id, 'rating',
              public.attendance_render(COALESCE(NULLIF(v_cfg ->> 'rating_text', ''),
                'Como foi o nosso atendimento? Responda com uma nota de 1 a 5.'), NEW));
      UPDATE tickets SET rating_requested_at = NOW() WHERE id = NEW.current_ticket_id;
    ELSIF (v_cfg ->> 'close_enabled') = 'true' AND COALESCE(v_cfg ->> 'close_text', '') <> '' THEN
      INSERT INTO attendance_outbox (account_id, conversation_id, ticket_id, kind, body)
      VALUES (NEW.account_id, NEW.id, NEW.current_ticket_id, 'close', public.attendance_render(v_cfg ->> 'close_text', NEW));
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.status = 'closed' THEN RETURN NULL; END IF;

  IF OLD.assigned_agent_id IS NULL AND NEW.assigned_agent_id IS NOT NULL
     AND NEW.department_id IS NOT DISTINCT FROM OLD.department_id THEN
    IF (v_cfg ->> 'accept_enabled') = 'true' AND COALESCE(v_cfg ->> 'accept_text', '') <> '' THEN
      INSERT INTO attendance_outbox (account_id, conversation_id, ticket_id, kind, body)
      VALUES (NEW.account_id, NEW.id, NEW.current_ticket_id, 'accept', public.attendance_render(v_cfg ->> 'accept_text', NEW));
    END IF;
  ELSIF NEW.department_id IS DISTINCT FROM OLD.department_id
     OR (OLD.assigned_agent_id IS NOT NULL AND NEW.assigned_agent_id IS NOT NULL
         AND NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id) THEN
    IF (v_cfg ->> 'transfer_enabled') = 'true' AND COALESCE(v_cfg ->> 'transfer_text', '') <> '' THEN
      INSERT INTO attendance_outbox (account_id, conversation_id, ticket_id, kind, body)
      VALUES (NEW.account_id, NEW.id, NEW.current_ticket_id, 'transfer', public.attendance_render(v_cfg ->> 'transfer_text', NEW));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.attendance_enqueue() OWNER TO postgres;
DROP TRIGGER IF EXISTS attendance_enqueue ON conversations;
CREATE TRIGGER attendance_enqueue
  AFTER UPDATE OF status, assigned_agent_id, department_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.attendance_enqueue();

-- Reserva atômica de itens da fila de saída (o envio pelo cron e o
-- "cutucão" da tela nunca pegam o mesmo item).
CREATE OR REPLACE FUNCTION public.claim_attendance_outbox(p_account UUID, p_limit INT DEFAULT 20)
RETURNS SETOF attendance_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE attendance_outbox o SET claimed_at = NOW()
  WHERE o.id IN (
    SELECT id FROM attendance_outbox
    WHERE claimed_at IS NULL
      AND (p_account IS NULL OR account_id = p_account)
      AND created_at > NOW() - INTERVAL '1 hour'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
$$;
ALTER FUNCTION public.claim_attendance_outbox(UUID, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_attendance_outbox(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_outbox(UUID, INT) TO service_role;
