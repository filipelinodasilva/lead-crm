-- Várias conexões de WhatsApp por conta (estilo Whaticket): números por QR code (Evolution)
-- e, no máximo, uma conexão da API oficial da Meta por conta.
--
-- Ordem importa: as colunas e os índices entram primeiro e a restrição "um número por conta"
-- (UNIQUE account_id) só cai no fim, quando tudo o que depende dela já está no lugar.

-- 1. Nome de exibição e conexão padrão.
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

UPDATE whatsapp_config
SET name = CASE WHEN provider = 'evolution' THEN 'WhatsApp QR' ELSE 'WhatsApp oficial' END
WHERE name IS NULL;

-- Cada conta tinha no máximo uma linha; ela vira a padrão.
UPDATE whatsapp_config w
SET is_default = true
WHERE NOT EXISTS (
  SELECT 1 FROM whatsapp_config o WHERE o.account_id = w.account_id AND o.is_default AND o.id <> w.id
);

-- 2. Uma conexão padrão por conta; uma conexão da Meta por conta.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_default
  ON whatsapp_config (account_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_meta
  ON whatsapp_config (account_id) WHERE provider = 'meta';

-- 3. A conversa lembra por qual número o cliente conversa (a resposta sai pelo mesmo número).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL;

UPDATE conversations c
SET whatsapp_config_id = w.id
FROM whatsapp_config w
WHERE w.account_id = c.account_id AND c.whatsapp_config_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);

-- 4. Por último: libera mais de uma conexão por conta.
-- UNIQUE(phone_number_id) continua: o roteamento das mensagens recebidas depende dele.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
