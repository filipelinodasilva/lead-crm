-- ============================================================
-- 065_prospect_dataforseo.sql — DataForSEO as an alternative ranking provider
--
-- Credentials are stored encrypted by the app (same as the Google key).
-- rank_provider: 'auto' = DataForSEO if configured, else Google key, else test.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE prospect_settings
  ADD COLUMN IF NOT EXISTS dataforseo_login text,
  ADD COLUMN IF NOT EXISTS dataforseo_password text,
  ADD COLUMN IF NOT EXISTS rank_provider text NOT NULL DEFAULT 'auto';

ALTER TABLE prospect_settings
  DROP CONSTRAINT IF EXISTS prospect_settings_rank_provider_check;
ALTER TABLE prospect_settings
  ADD CONSTRAINT prospect_settings_rank_provider_check
  CHECK (rank_provider IN ('auto', 'google', 'dataforseo'));

ALTER TABLE prospect_rank_scans
  DROP CONSTRAINT IF EXISTS prospect_rank_scans_provider_check;
ALTER TABLE prospect_rank_scans
  ADD CONSTRAINT prospect_rank_scans_provider_check
  CHECK (provider IN ('google', 'dataforseo', 'mock'));
