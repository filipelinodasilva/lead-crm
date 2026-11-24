-- Lead CRM: motor gratuito (gosom) como provedor de busca.
-- Só amplia a lista aceita em prospect_searches.provider; nenhum dado muda.
ALTER TABLE prospect_searches
  DROP CONSTRAINT IF EXISTS prospect_searches_provider_check;
ALTER TABLE prospect_searches
  ADD CONSTRAINT prospect_searches_provider_check
  CHECK (provider IN ('google', 'gosom', 'mock'));
