-- ============================================================
-- 064_prospect_rank.sql — Lead CRM: local ranking (geo-grid)
--
-- A scan measures where one business shows up in Google Maps results for a
-- keyword, on a grid of points around it. Each point asks "if I searched this
-- keyword standing here, in which position does the business appear?".
--
-- Tables
--   prospect_rank_scans   one row per measurement (target, keyword, grid, totals)
--   prospect_rank_points  one row per grid point (position found, top results)
--
-- Notes
--   - The engine runs with the service role (inline right after the scan is
--     created, then the scheduler finishes whatever is left).
--   - `prospect_add_usage_system` lets the engine count paid requests without a
--     signed-in user; it is granted to service_role only.
--   - rank_request_cap is the monthly limit of grid-point requests (its own
--     counter, provider "google_rank", separate from the lead search counter).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE prospect_settings
  ADD COLUMN IF NOT EXISTS rank_request_cap integer NOT NULL DEFAULT 500
    CHECK (rank_request_cap >= 0);

CREATE TABLE IF NOT EXISTS prospect_rank_scans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_id        uuid REFERENCES prospect_leads(id) ON DELETE SET NULL,
  target_place_id text NOT NULL,
  target_name    text NOT NULL,
  target_lat     double precision NOT NULL,
  target_lng     double precision NOT NULL,
  keyword        text NOT NULL,
  center_lat     double precision NOT NULL,
  center_lng     double precision NOT NULL,
  grid_size      integer NOT NULL CHECK (grid_size IN (3, 5, 7, 9)),
  spacing_m      integer NOT NULL CHECK (spacing_m BETWEEN 100 AND 10000),
  provider       text NOT NULL CHECK (provider IN ('google', 'mock')),
  status         text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error          text,
  points_total   integer NOT NULL,
  points_done    integer NOT NULL DEFAULT 0,
  requests_made  integer NOT NULL DEFAULT 0,
  found_count    integer,
  top3_count     integer,
  avg_rank       numeric(4,1),
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);

CREATE INDEX IF NOT EXISTS prospect_rank_scans_account_idx
  ON prospect_rank_scans (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prospect_rank_scans_open_idx
  ON prospect_rank_scans (status) WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS prospect_rank_points (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id    uuid NOT NULL REFERENCES prospect_rank_scans(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  row_idx    integer NOT NULL,
  col_idx    integer NOT NULL,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  rank       integer CHECK (rank IS NULL OR rank BETWEEN 1 AND 60),
  top        jsonb NOT NULL DEFAULT '[]',
  attempts   integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  UNIQUE (scan_id, row_idx, col_idx)
);

CREATE INDEX IF NOT EXISTS prospect_rank_points_scan_idx
  ON prospect_rank_points (scan_id, status);

-- ---- RLS ----------------------------------------------------
ALTER TABLE prospect_rank_scans  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_rank_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospect_rank_scans_select ON prospect_rank_scans;
CREATE POLICY prospect_rank_scans_select ON prospect_rank_scans FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS prospect_rank_scans_insert ON prospect_rank_scans;
CREATE POLICY prospect_rank_scans_insert ON prospect_rank_scans FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS prospect_rank_scans_delete ON prospect_rank_scans;
CREATE POLICY prospect_rank_scans_delete ON prospect_rank_scans FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS prospect_rank_points_select ON prospect_rank_points;
CREATE POLICY prospect_rank_points_select ON prospect_rank_points FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS prospect_rank_points_insert ON prospect_rank_points;
CREATE POLICY prospect_rank_points_insert ON prospect_rank_points FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ---- Usage counter for the engine (no signed-in user) --------
CREATE OR REPLACE FUNCTION prospect_add_usage_system(
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

ALTER FUNCTION prospect_add_usage_system(uuid, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION prospect_add_usage_system(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prospect_add_usage_system(uuid, text, integer) TO service_role;

-- ---- Joining another account must not silently drop ranking data --------
-- Same function as 063 with the two new tables added to the emptiness check.
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
    UNION ALL SELECT 1 FROM prospect_campaigns WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM prospect_campaign_recipients WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM prospect_optouts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM prospect_rank_scans WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM prospect_rank_points WHERE account_id = v_old_account_id
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
