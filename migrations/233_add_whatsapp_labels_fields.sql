-- Поля для отслеживания синхронизации ярлыков WhatsApp через wwebjs
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_label_synced BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_label_synced_at TIMESTAMPTZ;

-- Индекс для быстрого поиска несинхронизированных квалифицированных лидов
CREATE INDEX IF NOT EXISTS idx_leads_label_sync
  ON leads (user_account_id)
  WHERE (is_qualified = true OR reached_key_stage = true)
    AND (whatsapp_label_synced IS NULL OR whatsapp_label_synced = false)
    AND chat_id IS NOT NULL
    AND source_type = 'whatsapp';

-- ID ярлыка WhatsApp, который означает "оплатил" (настраивается в профиле)
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS wwebjs_label_id TEXT;
