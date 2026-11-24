-- ============================================================
-- 069_tickets.sql — Ticket = um ciclo de atendimento (modelo do
-- Whaticket/TicketTraking), numerado por conta, com linha do tempo.
--
-- A conversa continua única por contato (o histórico de mensagens não
-- se divide). Cada vez que uma conversa é criada ou reaberta depois de
-- fechada, nasce um ticket novo. Tudo é gravado por trigger: nenhum
-- caminho de escrita do app precisa mudar.
--
--   tickets        número, setor, responsável, aberto/aceito/fechado, motivo, nota
--   ticket_events  linha do tempo (aberto, assumido, transferido, pendente, fechado)
--   conversations  + current_ticket_id, ticket_number (para a lista, sem join)
--   contact_notes  + ticket_id (nota interna ligada ao atendimento)
-- Idempotente.
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ticket_seq BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  number BIGINT NOT NULL,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_reason_id UUID REFERENCES close_reasons(id) ON DELETE SET NULL,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  UNIQUE (account_id, number)
);
CREATE INDEX IF NOT EXISTS idx_tickets_conversation ON tickets(conversation_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_account_opened ON tickets(account_id, opened_at);

CREATE TABLE IF NOT EXISTS ticket_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('opened', 'reopened', 'assigned', 'unassigned', 'transferred', 'department', 'pending', 'resumed', 'closed', 'rated')),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  closed_reason_id UUID REFERENCES close_reasons(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events(ticket_id, created_at);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS current_ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ticket_number BIGINT;

ALTER TABLE contact_notes
  ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL;

-- ============================================================
-- RLS: vê o ticket quem vê a conversa (a policy de conversations,
-- com as regras de atendimento da 068, é avaliada dentro do EXISTS).
-- Ninguém escreve pelo cliente; só os triggers (SECURITY DEFINER).
-- ============================================================
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tickets_select ON tickets;
CREATE POLICY tickets_select ON tickets FOR SELECT USING (
  is_account_member(account_id)
  AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = tickets.conversation_id));
DROP POLICY IF EXISTS ticket_events_select ON ticket_events;
CREATE POLICY ticket_events_select ON ticket_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM tickets t WHERE t.id = ticket_events.ticket_id));

-- ============================================================
-- Funções
-- ============================================================
CREATE OR REPLACE FUNCTION public.open_ticket(p_conv conversations, p_event TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_num BIGINT;
  v_id UUID;
BEGIN
  -- a linha de accounts fica travada até o fim da transação: números sem repetição
  UPDATE accounts SET ticket_seq = ticket_seq + 1 WHERE id = p_conv.account_id RETURNING ticket_seq INTO v_num;
  INSERT INTO tickets (account_id, conversation_id, number, department_id, assigned_agent_id, accepted_at)
  VALUES (p_conv.account_id, p_conv.id, v_num, p_conv.department_id, p_conv.assigned_agent_id,
          CASE WHEN p_conv.assigned_agent_id IS NOT NULL THEN NOW() END)
  RETURNING id INTO v_id;
  INSERT INTO ticket_events (ticket_id, type, actor_user_id, agent_id, department_id)
  VALUES (v_id, p_event, auth.uid(), p_conv.assigned_agent_id, p_conv.department_id);
  UPDATE conversations SET current_ticket_id = v_id, ticket_number = v_num WHERE id = p_conv.id;
  RETURN v_id;
END;
$$;
ALTER FUNCTION public.open_ticket(conversations, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.open_ticket(conversations, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.conversation_ticket_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.open_ticket(NEW, 'opened');
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.conversation_ticket_on_insert() OWNER TO postgres;
DROP TRIGGER IF EXISTS conversation_ticket_on_insert ON conversations;
CREATE TRIGGER conversation_ticket_on_insert
  AFTER INSERT ON conversations FOR EACH ROW EXECUTE FUNCTION public.conversation_ticket_on_insert();

CREATE OR REPLACE FUNCTION public.conversation_ticket_on_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t UUID := NEW.current_ticket_id;
  v_me UUID := auth.uid();
BEGIN
  -- a própria atualização do ponteiro (feita por open_ticket) não gera evento
  IF NEW.current_ticket_id IS DISTINCT FROM OLD.current_ticket_id THEN RETURN NULL; END IF;

  -- reabriu (cliente voltou ou alguém reabriu): ciclo novo
  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    PERFORM public.open_ticket(NEW, 'reopened');
    RETURN NULL;
  END IF;
  IF v_t IS NULL THEN
    PERFORM public.open_ticket(NEW, 'opened');
    RETURN NULL;
  END IF;

  IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    UPDATE tickets SET department_id = NEW.department_id WHERE id = v_t;
    INSERT INTO ticket_events (ticket_id, type, actor_user_id, department_id)
    VALUES (v_t, 'department', v_me, NEW.department_id);
  END IF;

  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    UPDATE tickets SET assigned_agent_id = NEW.assigned_agent_id,
                       accepted_at = COALESCE(accepted_at, CASE WHEN NEW.assigned_agent_id IS NOT NULL THEN NOW() END)
    WHERE id = v_t;
    INSERT INTO ticket_events (ticket_id, type, actor_user_id, agent_id)
    VALUES (v_t,
            CASE WHEN NEW.assigned_agent_id IS NULL THEN 'unassigned'
                 WHEN OLD.assigned_agent_id IS NULL THEN 'assigned'
                 ELSE 'transferred' END,
            v_me, NEW.assigned_agent_id);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'closed' THEN
      UPDATE tickets SET closed_at = NOW(), closed_reason_id = NEW.closed_reason_id, closed_by = v_me WHERE id = v_t;
      INSERT INTO ticket_events (ticket_id, type, actor_user_id, closed_reason_id)
      VALUES (v_t, 'closed', v_me, NEW.closed_reason_id);
    ELSE
      INSERT INTO ticket_events (ticket_id, type, actor_user_id)
      VALUES (v_t, CASE WHEN NEW.status = 'pending' THEN 'pending' ELSE 'resumed' END, v_me);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.conversation_ticket_on_update() OWNER TO postgres;
DROP TRIGGER IF EXISTS conversation_ticket_on_update ON conversations;
CREATE TRIGGER conversation_ticket_on_update
  AFTER UPDATE OF status, assigned_agent_id, department_id, current_ticket_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversation_ticket_on_update();

-- Nota interna nova feita durante um atendimento fica ligada ao ticket atual do contato.
CREATE OR REPLACE FUNCTION public.contact_note_link_ticket()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.ticket_id IS NULL THEN
    SELECT c.current_ticket_id INTO NEW.ticket_id
    FROM conversations c WHERE c.contact_id = NEW.contact_id AND c.status <> 'closed'
    ORDER BY c.updated_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.contact_note_link_ticket() OWNER TO postgres;
DROP TRIGGER IF EXISTS contact_note_link_ticket ON contact_notes;
CREATE TRIGGER contact_note_link_ticket
  BEFORE INSERT ON contact_notes FOR EACH ROW EXECUTE FUNCTION public.contact_note_link_ticket();

-- ============================================================
-- Conversas existentes: um ticket para o ciclo atual de cada uma
-- ============================================================
DO $$
DECLARE r conversations;
BEGIN
  FOR r IN SELECT * FROM conversations WHERE current_ticket_id IS NULL ORDER BY created_at LOOP
    PERFORM public.open_ticket(r, 'opened');
    UPDATE tickets SET opened_at = r.created_at,
                       closed_at = CASE WHEN r.status = 'closed' THEN COALESCE(r.closed_at, r.updated_at) END,
                       closed_reason_id = r.closed_reason_id
    WHERE conversation_id = r.id;
  END LOOP;
END $$;
