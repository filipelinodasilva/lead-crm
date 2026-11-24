-- ============================================================
-- 067_subcontas_trial.sql — Subcontas, teste de 7 dias e bloqueio
--
-- O que muda
--   1. accounts ganha parent_account_id (hierarquia de um nível),
--      status ('trial' | 'active' | 'blocked') e trial_ends_at
--      (7 dias a partir da criação). Toda conta nova nasce em teste.
--   2. profiles ganha active_account_id: a conta em que o usuário
--      está operando agora (NULL = a própria conta). Trocar de conta
--      é só mudar esse ponteiro (RPC switch_account).
--   3. platform_admins: quem opera o SaaS (vê e administra todas as
--      contas, bloqueia e libera manualmente).
--   4. is_account_member passa a avaliar a conta ATIVA do usuário,
--      e nega tudo quando essa conta está bloqueada ou com o teste
--      vencido (exceto para platform admin). Dono/admin da conta-mãe
--      age como 'admin' dentro das subcontas.
--   5. Cliente (authenticated) não consegue mudar status, teste nem
--      hierarquia por UPDATE direto; só o painel (service_role).
--
-- Idempotente.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS parent_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial', 'active', 'blocked')),
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days');

CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_account_id);

-- O dono de uma agência passa a ser dono de várias contas (as subcontas).
DROP INDEX IF EXISTS idx_accounts_one_per_owner;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS active_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_admins_self ON platform_admins;
CREATE POLICY platform_admins_self ON platform_admins FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- HELPERS
-- ============================================================
CREATE OR REPLACE FUNCTION role_rank(r account_role_enum) RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END;
$$;

CREATE OR REPLACE FUNCTION is_platform_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION account_blocked(target_account_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.id = target_account_id
      AND (a.status = 'blocked' OR (a.status = 'trial' AND a.trial_ends_at < NOW()))
  );
$$;
GRANT EXECUTE ON FUNCTION account_blocked(UUID) TO authenticated, service_role;

-- Pode o usuário atual ENTRAR nesta conta? A própria, uma subconta da
-- própria (sendo owner/admin) ou qualquer uma (platform admin).
CREATE OR REPLACE FUNCTION can_access_account(target_account_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_platform_admin() OR EXISTS (
    SELECT 1
    FROM profiles p
    JOIN accounts a ON a.id = target_account_id
    WHERE p.user_id = auth.uid()
      AND (a.id = p.account_id
           OR (a.parent_account_id = p.account_id AND p.account_role IN ('owner', 'admin')))
  );
$$;
GRANT EXECUTE ON FUNCTION can_access_account(UUID) TO authenticated, service_role;

-- Mesma assinatura da 017 (todas as policies continuam válidas), mas
-- avaliando a conta ativa e o bloqueio.
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND COALESCE(p.active_account_id, p.account_id) = target_account_id
      AND role_rank(CASE WHEN p.active_account_id IS NULL OR p.active_account_id = p.account_id
                         THEN p.account_role ELSE 'admin'::account_role_enum END) >= role_rank(min_role)
      AND (p.active_account_id IS NULL OR can_access_account(p.active_account_id))
      AND (is_platform_admin() OR NOT account_blocked(target_account_id))
  );
$$;

-- A linha da conta continua legível mesmo bloqueada (a tela de bloqueio
-- precisa mostrar até quando foi o teste) e as subcontas aparecem na lista.
DROP POLICY IF EXISTS accounts_select ON accounts;
CREATE POLICY accounts_select ON accounts FOR SELECT USING (can_access_account(id));

-- Cliente não se desbloqueia sozinho.
CREATE OR REPLACE FUNCTION public.enforce_account_billing_columns()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status
      OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
      OR NEW.parent_account_id IS DISTINCT FROM OLD.parent_account_id)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION 'status, trial_ends_at and parent_account_id are managed by the platform'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_account_billing_columns() OWNER TO postgres;
DROP TRIGGER IF EXISTS enforce_account_billing_columns ON public.accounts;
CREATE TRIGGER enforce_account_billing_columns
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_billing_columns();

-- ============================================================
-- RPCs
-- ============================================================

-- Cria uma subconta da conta do chamador (owner/admin). Um nível só:
-- subconta não cria subconta.
CREATE OR REPLACE FUNCTION public.create_subaccount(p_name TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_home UUID;
  v_role account_role_enum;
  v_parent UUID;
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 OR length(p_name) > 80 THEN
    RAISE EXCEPTION 'Invalid name' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, p.account_role, a.parent_account_id
    INTO v_home, v_role, v_parent
  FROM profiles p JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = auth.uid();

  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners and admins can create subaccounts' USING ERRCODE = '42501';
  END IF;
  IF v_parent IS NOT NULL THEN
    RAISE EXCEPTION 'A subaccount cannot create subaccounts' USING ERRCODE = '42501';
  END IF;
  IF account_blocked(v_home) AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Account is blocked' USING ERRCODE = '42501';
  END IF;

  INSERT INTO accounts (name, owner_user_id, parent_account_id)
  VALUES (trim(p_name), auth.uid(), v_home)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
ALTER FUNCTION public.create_subaccount(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_subaccount(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_subaccount(TEXT) TO authenticated;

-- Troca a conta ativa. NULL (ou a própria conta) volta para casa.
CREATE OR REPLACE FUNCTION public.switch_account(p_account_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_home UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT account_id INTO v_home FROM profiles WHERE user_id = auth.uid();

  IF p_account_id IS NULL OR p_account_id = v_home THEN
    UPDATE profiles SET active_account_id = NULL WHERE user_id = auth.uid();
  ELSIF can_access_account(p_account_id) THEN
    UPDATE profiles SET active_account_id = p_account_id WHERE user_id = auth.uid();
  ELSE
    RAISE EXCEPTION 'No access to this account' USING ERRCODE = '42501';
  END IF;
END;
$$;
ALTER FUNCTION public.switch_account(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.switch_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.switch_account(UUID) TO authenticated;
