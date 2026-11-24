-- ============================================================
-- 063_prospect_campaigns.sql — Lead CRM: mass sending ("disparo")
--
-- A campaign watches one pipeline stage. Every deal in that stage becomes a
-- recipient and receives a first message plus up to two follow-ups, at a
-- pace the owner sets (daily limit, window, days, interval between sends),
-- through one WhatsApp connection (QR/Evolution or the official API).
--
-- Tables
--   prospect_campaigns            the automation and its limits
--   prospect_campaign_recipients  one row per contact in a campaign
--   prospect_optouts              numbers that asked to stop (never messaged again)
--
-- Notes
--   - The engine runs with the service role (scheduler hits /api/prospect/cron
--     every minute). RLS here guards the dashboard routes, which use the
--     signed-in user's client.
--   - A recipient is `queued` while it still has a message to send (step 0 is
--     the first message, 1 and 2 are follow-ups, each waiting for next_due_at),
--     `sent` once the sequence is complete, and `replied` / `opted_out` /
--     `failed` / `skipped` otherwise.
--   - UNIQUE (campaign_id, contact_id) keeps the stage watcher idempotent.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS prospect_campaigns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name                text NOT NULL,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'running', 'paused', 'done')),
  paused_reason       text,
  pipeline_id         uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id            uuid NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  sent_stage_id       uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  reply_stage_id      uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  connection_id       uuid REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  kind                text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'template')),
  message_text        text,
  template_name       text,
  template_language   text NOT NULL DEFAULT 'pt_BR',
  template_vars       text[] NOT NULL DEFAULT '{}',
  followups           jsonb NOT NULL DEFAULT '[]',
  include_optout      boolean NOT NULL DEFAULT true,
  stop_on_reply       boolean NOT NULL DEFAULT true,
  daily_limit         integer NOT NULL DEFAULT 30 CHECK (daily_limit BETWEEN 1 AND 500),
  warmup              boolean NOT NULL DEFAULT true,
  window_start_min    integer NOT NULL DEFAULT 540 CHECK (window_start_min BETWEEN 0 AND 1439),
  window_end_min      integer NOT NULL DEFAULT 1080 CHECK (window_end_min BETWEEN 1 AND 1440),
  days                smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  timezone            text NOT NULL DEFAULT 'America/Sao_Paulo',
  min_interval_s      integer NOT NULL DEFAULT 45 CHECK (min_interval_s >= 10),
  max_interval_s      integer NOT NULL DEFAULT 120,
  next_send_at        timestamptz,
  consecutive_errors  integer NOT NULL DEFAULT 0,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end_min > window_start_min),
  CHECK (max_interval_s >= min_interval_s)
);

CREATE INDEX IF NOT EXISTS prospect_campaigns_account_idx
  ON prospect_campaigns (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prospect_campaigns_running_idx
  ON prospect_campaigns (status) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS prospect_campaign_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES prospect_campaigns(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id         uuid REFERENCES deals(id) ON DELETE SET NULL,
  contact_id      uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES prospect_leads(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'sent', 'replied', 'opted_out', 'failed', 'skipped')),
  step            integer NOT NULL DEFAULT 0,
  next_due_at     timestamptz NOT NULL DEFAULT now(),
  attempts        integer NOT NULL DEFAULT 0,
  error           text,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  first_sent_at   timestamptz,
  last_sent_at    timestamptz,
  replied_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS prospect_recipients_due_idx
  ON prospect_campaign_recipients (campaign_id, status, next_due_at);
CREATE INDEX IF NOT EXISTS prospect_recipients_account_idx
  ON prospect_campaign_recipients (account_id);

CREATE TABLE IF NOT EXISTS prospect_optouts (
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phone_normalized text NOT NULL,
  source           text NOT NULL DEFAULT 'reply',
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, phone_normalized)
);

-- ---- RLS ----------------------------------------------------
ALTER TABLE prospect_campaigns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_optouts             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospect_campaigns_select ON prospect_campaigns;
CREATE POLICY prospect_campaigns_select ON prospect_campaigns FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS prospect_campaigns_insert ON prospect_campaigns;
CREATE POLICY prospect_campaigns_insert ON prospect_campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS prospect_campaigns_update ON prospect_campaigns;
CREATE POLICY prospect_campaigns_update ON prospect_campaigns FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS prospect_campaigns_delete ON prospect_campaigns;
CREATE POLICY prospect_campaigns_delete ON prospect_campaigns FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS prospect_recipients_select ON prospect_campaign_recipients;
CREATE POLICY prospect_recipients_select ON prospect_campaign_recipients FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS prospect_recipients_insert ON prospect_campaign_recipients;
CREATE POLICY prospect_recipients_insert ON prospect_campaign_recipients FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS prospect_recipients_update ON prospect_campaign_recipients;
CREATE POLICY prospect_recipients_update ON prospect_campaign_recipients FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS prospect_recipients_delete ON prospect_campaign_recipients;
CREATE POLICY prospect_recipients_delete ON prospect_campaign_recipients FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS prospect_optouts_select ON prospect_optouts;
CREATE POLICY prospect_optouts_select ON prospect_optouts FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS prospect_optouts_insert ON prospect_optouts;
CREATE POLICY prospect_optouts_insert ON prospect_optouts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS prospect_optouts_delete ON prospect_optouts;
CREATE POLICY prospect_optouts_delete ON prospect_optouts FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ---- Joining another account must not silently drop campaign data --------
-- Same function as 062 with the three new tables added to the emptiness check.
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
