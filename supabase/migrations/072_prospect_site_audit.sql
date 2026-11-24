-- ============================================================
-- 072_prospect_site_audit.sql — Fase 3: diagnóstico de site do lead (pixels, redes, WhatsApp, e-mail)
--
-- Mantém os sinais extraídos do site diretamente em `prospect_leads` para recalibrar
-- a nota de oportunidade (`scoreLead`), filtrar quem tem site sem Pixel/GTM,
-- exportar no CSV/webhook e exibir no painel lateral do lead.
-- Idempotente.
-- ============================================================

ALTER TABLE prospect_leads
  ADD COLUMN IF NOT EXISTS site_data       jsonb,
  ADD COLUMN IF NOT EXISTS site_checked_at timestamptz;
