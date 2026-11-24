-- ============================================================
-- 062_prospecting.sql — Lead CRM: lead prospecting (Google Places)
--
-- Tables
--   prospect_settings  one row per account: Google API key (encrypted),
--                      monthly request cap, webhook target + signing secret
--   prospect_searches  one row per search the account ran
--   prospect_leads     businesses found (one row per account + Google place)
--   prospect_usage     paid Google requests counted per account/month
--
-- Design notes
--   - Account-scoped like api_keys / webhook_endpoints. Settings are
--     admin-only (they hold secrets); leads and searches follow the
--     contacts convention (members read, agent+ write).
--   - Re-running a search upserts on (account_id, place_id): fresh Google
--     data overwrites name/rating/phone, but status, contact_id and
--     webhook_sent_at are never touched by a re-collection.
--   - `collected_at` records when Google data was fetched so the UI can
--     show its age (Google's terms limit how long content may be cached).
--   - Usage is incremented through `prospect_add_usage` so two parallel
--     searches cannot lose a count.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS prospect_settings (
  account_id          uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  google_api_key      text,                         -- AES-256-GCM-encrypted
  monthly_request_cap integer NOT NULL DEFAULT 900 CHECK (monthly_request_cap >= 0),
  webhook_url         text,
  webhook_secret      text,                         -- AES-256-GCM-encrypted HMAC secret
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prospect_searches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  query         text NOT NULL,                      -- e.g. "dentista"
  location_text text NOT NULL,                      -- e.g. "Belo Horizonte, MG"
  provider      text NOT NULL CHECK (provider IN ('google', 'mock')),
  max_results   integer NOT NULL DEFAULT 20,
  found_count   integer NOT NULL DEFAULT 0,
  new_count     integer NOT NULL DEFAULT 0,
  requests_made integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prospect_searches_account_idx
  ON prospect_searches (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prospect_leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  search_id       uuid REFERENCES prospect_searches(id) ON DELETE SET NULL,
  provider        text NOT NULL DEFAULT 'google',
  place_id        text NOT NULL,
  name            text NOT NULL,
  category        text,                             -- Google primaryType, e.g. "dentist"
  address         text,
  city            text,
  state           text,
  lat             double precision,
  lng             double precision,
  phone           text,                             -- as displayed, e.g. "(31) 99999-9999"
  phone_e164      text,                             -- e.g. "+5531999999999"
  phone_kind      text NOT NULL DEFAULT 'unknown' CHECK (phone_kind IN ('mobile', 'landline', 'unknown')),
  website         text,
  rating          numeric(2,1),
  review_count    integer NOT NULL DEFAULT 0,
  business_status text,
  maps_url        text,
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_pipeline', 'discarded')),
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  webhook_sent_at timestamptz,
  collected_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, place_id)
);

CREATE INDEX IF NOT EXISTS prospect_leads_account_status_idx
  ON prospect_leads (account_id, status);
CREATE INDEX IF NOT EXISTS prospect_leads_search_idx
  ON prospect_leads (search_id);

CREATE TABLE IF NOT EXISTS prospect_usage (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month      date NOT NULL,                         -- first day of the month (UTC)
  provider   text NOT NULL,
  requests   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, month, provider)
);

-- ---- RLS ----------------------------------------------------
ALTER TABLE prospect_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_searches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_leads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_usage     ENABLE ROW LEVEL SECURITY;

-- Settings hold secrets: admin+ only, for every operation.
DROP POLICY IF EXISTS prospect_settings_all ON prospect_settings;
CREATE POLICY prospect_settings_all ON prospect_settings FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS prospect_searches_select ON prospect_searches;
CREATE POLICY prospect_searches_select ON prospect_searches FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS prospect_searches_insert ON prospect_searches;
CREATE POLICY prospect_searches_insert ON prospect_searches FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS prospect_searches_delete ON prospect_searches;
CREATE POLICY prospect_searches_delete ON prospect_searches FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS prospect_leads_select ON prospect_leads;
CREATE POLICY prospect_leads_select ON prospect_leads FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS prospect_leads_insert ON prospect_leads;
CREATE POLICY prospect_leads_insert ON prospect_leads FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS prospect_leads_update ON prospect_leads;
CREATE POLICY prospect_leads_update ON prospect_leads FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS prospect_leads_delete ON prospect_leads;
CREATE POLICY prospect_leads_delete ON prospect_leads FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- Usage is read by members; writes only go through prospect_add_usage().
DROP POLICY IF EXISTS prospect_usage_select ON prospect_usage;
CREATE POLICY prospect_usage_select ON prospect_usage FOR SELECT
  USING (is_account_member(account_id));

-- ---- Atomic usage counter ------------------------------------
CREATE OR REPLACE FUNCTION prospect_add_usage(
  p_account_id uuid,
  p_provider   text,
  p_requests   integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
BEGIN
  IF NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'not a member of this account' USING ERRCODE = '42501';
  END IF;
  IF p_requests IS NULL OR p_requests < 0 THEN
    RAISE EXCEPTION 'invalid request count' USING ERRCODE = '22023';
  END IF;

  INSERT INTO prospect_usage (account_id, month, provider, requests)
  VALUES (p_account_id, date_trunc('month', now() AT TIME ZONE 'UTC')::date, p_provider, p_requests)
  ON CONFLICT (account_id, month, provider)
  DO UPDATE SET requests = prospect_usage.requests + EXCLUDED.requests
  RETURNING requests INTO v_total;

  RETURN v_total;
END;
$$;

ALTER FUNCTION prospect_add_usage(uuid, text, integer) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION prospect_add_usage(uuid, text, integer) TO authenticated, service_role;

-- ---- Joining another account must not silently drop prospecting data -----
-- Same function as 047 with the four prospect_* tables added to the emptiness check.
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM prospect_settings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM prospect_searches WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM prospect_leads WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM prospect_usage WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
