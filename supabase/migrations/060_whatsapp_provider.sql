-- Provedor de WhatsApp da conta: 'meta' (API oficial, padrão) ou 'evolution' (QR code, Evolution API).
-- Quando 'evolution', whatsapp_config.phone_number_id guarda 'evo_<instância>' e
-- access_token guarda a chave da instância criptografada (mesmo formato do token da Meta),
-- então as colunas existentes e a restrição de unicidade continuam valendo.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_provider_check'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_provider_check CHECK (provider IN ('meta', 'evolution'));
  END IF;
END $$;
