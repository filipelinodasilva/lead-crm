-- ============================================================
-- 068_atendimento.sql — Atendimento por setores (fila, assumir,
-- transferir, encerrar com motivo) com regras editáveis por conta.
--
--   departments          setores da conta (um é o padrão)
--   department_members   atendentes/supervisores de cada setor
--   close_reasons        motivos de encerramento da conta
--   accounts.ticket_rules  regras editáveis (JSON; ausente = padrão)
--   conversations        + department_id, closed_reason_id, closed_by
--
-- Estados continuam os de sempre: open / pending / closed.
--   fila            = open sem assigned_agent_id
--   em atendimento  = open com assigned_agent_id
--
-- Visibilidade decidida no banco (can_view_conversation), para valer em
-- tela, API, busca e realtime. Regras (chave JSON → padrão):
--   assumed_visibility        'owner' | 'department' | 'everyone'  → 'owner'
--   supervisors_see_assumed   bool                                 → true
--   queue_visibility          'department' | 'everyone'            → 'department'
--   viewers_see_conversations bool                                 → false
--   agents_can_transfer       bool (atendente transfere a própria)  → true
--   require_close_reason      bool                                 → true
--   reopen_with_last_agent_hours int (0 = sempre volta à fila)     → 24
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_departments_account ON departments(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_one_default
  ON departments(account_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS department_members (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'supervisor')),
  PRIMARY KEY (department_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_department_members_user ON department_members(user_id);

CREATE TABLE IF NOT EXISTS close_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_close_reasons_account ON close_reasons(account_id);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ticket_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_reason_id UUID REFERENCES close_reasons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_department ON conversations(department_id);

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

-- ============================================================
-- Regras
-- ============================================================
CREATE OR REPLACE FUNCTION ticket_rule(p_account UUID, p_key TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT ticket_rules ->> p_key FROM accounts WHERE id = p_account),
    CASE p_key
      WHEN 'assumed_visibility' THEN 'owner'
      WHEN 'supervisors_see_assumed' THEN 'true'
      WHEN 'queue_visibility' THEN 'department'
      WHEN 'viewers_see_conversations' THEN 'false'
      WHEN 'agents_can_transfer' THEN 'true'
      WHEN 'require_close_reason' THEN 'true'
      WHEN 'reopen_with_last_agent_hours' THEN '24'
    END);
$$;
GRANT EXECUTE ON FUNCTION ticket_rule(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION can_view_conversation(p_account UUID, p_department UUID, p_agent UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me UUID := auth.uid();
  v_in_dept BOOLEAN;
  v_supervisor BOOLEAN;
BEGIN
  IF v_me IS NULL THEN RETURN false; END IF;              -- service_role não passa por RLS
  IF is_account_member(p_account, 'admin') THEN RETURN true; END IF;
  IF NOT is_account_member(p_account, 'agent') THEN
    RETURN ticket_rule(p_account, 'viewers_see_conversations') = 'true';
  END IF;
  IF p_agent = v_me THEN RETURN true; END IF;

  v_in_dept := p_department IS NULL OR EXISTS (
    SELECT 1 FROM department_members WHERE department_id = p_department AND user_id = v_me);
  v_supervisor := p_department IS NOT NULL AND EXISTS (
    SELECT 1 FROM department_members WHERE department_id = p_department AND user_id = v_me AND role = 'supervisor');

  IF p_agent IS NULL THEN
    RETURN ticket_rule(p_account, 'queue_visibility') = 'everyone' OR v_in_dept;
  END IF;
  RETURN CASE ticket_rule(p_account, 'assumed_visibility')
    WHEN 'everyone' THEN true
    WHEN 'department' THEN v_in_dept
    ELSE ticket_rule(p_account, 'supervisors_see_assumed') = 'true' AND v_supervisor
  END;
END;
$$;
GRANT EXECUTE ON FUNCTION can_view_conversation(UUID, UUID, UUID) TO authenticated, service_role;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE close_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS departments_select ON departments;
DROP POLICY IF EXISTS departments_modify ON departments;
CREATE POLICY departments_select ON departments FOR SELECT USING (is_account_member(account_id));
CREATE POLICY departments_modify ON departments FOR ALL
  USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS department_members_select ON department_members;
DROP POLICY IF EXISTS department_members_modify ON department_members;
CREATE POLICY department_members_select ON department_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM departments d WHERE d.id = department_members.department_id AND is_account_member(d.account_id)));
CREATE POLICY department_members_modify ON department_members FOR ALL USING (
  EXISTS (SELECT 1 FROM departments d WHERE d.id = department_members.department_id AND is_account_member(d.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM departments d WHERE d.id = department_members.department_id AND is_account_member(d.account_id, 'admin')));

DROP POLICY IF EXISTS close_reasons_select ON close_reasons;
DROP POLICY IF EXISTS close_reasons_modify ON close_reasons;
CREATE POLICY close_reasons_select ON close_reasons FOR SELECT USING (is_account_member(account_id));
CREATE POLICY close_reasons_modify ON close_reasons FOR ALL
  USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

-- Conversas: além de ser da conta, precisa poder ver a conversa. As
-- policies de messages / message_reactions já consultam conversations
-- com RLS, então herdam a restrição sem mudança.
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (is_account_member(account_id) AND can_view_conversation(account_id, department_id, assigned_agent_id));
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_view_conversation(account_id, department_id, assigned_agent_id))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- Triggers
-- ============================================================

-- Conversa nova cai no setor do número, senão no setor padrão da conta.
CREATE OR REPLACE FUNCTION public.conversation_default_department()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.department_id IS NULL THEN
    SELECT COALESCE(
      (SELECT w.department_id FROM whatsapp_config w WHERE w.id = NEW.whatsapp_config_id),
      (SELECT d.id FROM departments d WHERE d.account_id = NEW.account_id AND d.is_default))
    INTO NEW.department_id;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.conversation_default_department() OWNER TO postgres;
DROP TRIGGER IF EXISTS conversation_default_department ON conversations;
CREATE TRIGGER conversation_default_department
  BEFORE INSERT ON conversations FOR EACH ROW EXECUTE FUNCTION public.conversation_default_department();

-- Encerrar exige motivo (regra); atendente só transfere se a regra deixa;
-- reabertura pelo cliente (sem usuário logado) devolve à fila quando o
-- encerramento é mais antigo que a regra de horas.
CREATE OR REPLACE FUNCTION public.enforce_ticket_rules()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_me UUID := auth.uid();
  v_hours INT;
BEGIN
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    IF v_me IS NOT NULL AND NEW.closed_reason_id IS NULL
       AND ticket_rule(NEW.account_id, 'require_close_reason') = 'true' THEN
      RAISE EXCEPTION 'close_reason_required' USING ERRCODE = '23514';
    END IF;
    NEW.closed_by := v_me;
  END IF;

  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    NEW.closed_reason_id := NULL;
    NEW.closed_by := NULL;
    IF v_me IS NULL AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      v_hours := COALESCE(ticket_rule(NEW.account_id, 'reopen_with_last_agent_hours'), '24')::int;
      IF OLD.closed_at IS NULL OR OLD.closed_at < NOW() - make_interval(hours => v_hours) THEN
        NEW.assigned_agent_id := NULL;
      END IF;
    END IF;
  END IF;

  IF v_me IS NOT NULL
     AND NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id
     AND NEW.assigned_agent_id IS DISTINCT FROM v_me
     AND NOT is_account_member(NEW.account_id, 'admin')
     AND NOT EXISTS (SELECT 1 FROM department_members
                     WHERE department_id = NEW.department_id AND user_id = v_me AND role = 'supervisor')
     AND ticket_rule(NEW.account_id, 'agents_can_transfer') <> 'true' THEN
    RAISE EXCEPTION 'transfer_not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_ticket_rules() OWNER TO postgres;
DROP TRIGGER IF EXISTS enforce_ticket_rules ON conversations;
CREATE TRIGGER enforce_ticket_rules
  BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION public.enforce_ticket_rules();

-- ============================================================
-- Dados padrão: todo setor/motivo vem pronto em cada conta
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_ticket_defaults(p_account UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO departments (account_id, name, is_default)
  SELECT p_account, 'Atendimento', true
  WHERE NOT EXISTS (SELECT 1 FROM departments WHERE account_id = p_account);
  -- todo membro atual entra no setor padrão (dono/admin como supervisor)
  INSERT INTO department_members (department_id, user_id, role)
  SELECT d.id, p.user_id, CASE WHEN p.account_role IN ('owner','admin') THEN 'supervisor' ELSE 'agent' END
  FROM departments d JOIN profiles p ON p.account_id = p_account
  WHERE d.account_id = p_account AND d.is_default
  ON CONFLICT DO NOTHING;
  INSERT INTO close_reasons (account_id, name, sort_order)
  SELECT p_account, r.name, r.ord
  FROM (VALUES ('Venda realizada', 1), ('Sem interesse', 2), ('Sem resposta', 3), ('Resolvido', 4), ('Spam', 5), ('Outro', 6)) AS r(name, ord)
  WHERE NOT EXISTS (SELECT 1 FROM close_reasons WHERE account_id = p_account);
END;
$$;
ALTER FUNCTION public.seed_ticket_defaults(UUID) OWNER TO postgres;

-- contas existentes
SELECT public.seed_ticket_defaults(id) FROM accounts;

-- contas novas (cadastro, subconta, membro removido): o trigger de accounts
-- semeia; o dono entra no setor assim que o perfil existir (trigger de profiles).
CREATE OR REPLACE FUNCTION public.on_account_created_seed_tickets()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.seed_ticket_defaults(NEW.id);
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.on_account_created_seed_tickets() OWNER TO postgres;
DROP TRIGGER IF EXISTS on_account_created_seed_tickets ON accounts;
CREATE TRIGGER on_account_created_seed_tickets
  AFTER INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION public.on_account_created_seed_tickets();

-- Membro novo (cadastro, convite aceito, troca de conta) entra no setor padrão da conta.
CREATE OR REPLACE FUNCTION public.on_profile_account_join_department()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO department_members (department_id, user_id, role)
  SELECT d.id, NEW.user_id, CASE WHEN NEW.account_role IN ('owner','admin') THEN 'supervisor' ELSE 'agent' END
  FROM departments d WHERE d.account_id = NEW.account_id AND d.is_default
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.on_profile_account_join_department() OWNER TO postgres;
DROP TRIGGER IF EXISTS on_profile_account_join_department ON profiles;
CREATE TRIGGER on_profile_account_join_department
  AFTER INSERT OR UPDATE OF account_id ON profiles FOR EACH ROW EXECUTE FUNCTION public.on_profile_account_join_department();
