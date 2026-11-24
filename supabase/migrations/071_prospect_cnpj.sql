-- ============================================================
-- 071_prospect_cnpj.sql — Fase 2: enriquecimento de leads do Maps com CNPJ da Receita
--
-- Mantém o resultado do casamento no próprio lead para leitura imediata na tabela,
-- exportação CSV, webhook e confirmação manual quando houver mais de um candidato.
-- Re-coletas do Google/gosom atualizam apenas campos do Maps (não sobrescrevem o CNPJ).
-- Idempotente.
-- ============================================================

ALTER TABLE prospect_leads
  ADD COLUMN IF NOT EXISTS cnpj              text,
  ADD COLUMN IF NOT EXISTS cnpj_match_status text CHECK (cnpj_match_status IN ('matched', 'review', 'none')),
  ADD COLUMN IF NOT EXISTS cnpj_match_method text CHECK (cnpj_match_method IN ('phone', 'address', 'name', 'review', 'manual', 'none')),
  ADD COLUMN IF NOT EXISTS cnpj_data         jsonb,
  ADD COLUMN IF NOT EXISTS cnpj_checked_at   timestamptz;

CREATE INDEX IF NOT EXISTS prospect_leads_account_cnpj_idx
  ON prospect_leads (account_id, cnpj_match_status);
