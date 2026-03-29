-- Двухуровневая квалификация: is_paid + синхронизация paid-ярлыка
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_paid_label_synced BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_paid_label_synced_at TIMESTAMPTZ;

-- User accounts: два ярлыка вместо одного
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS wwebjs_label_id_lead TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS wwebjs_label_id_paid TEXT;

-- Миграция старых данных: копируем wwebjs_label_id → wwebjs_label_id_lead
UPDATE user_accounts
SET wwebjs_label_id_lead = wwebjs_label_id
WHERE wwebjs_label_id IS NOT NULL AND wwebjs_label_id_lead IS NULL;

-- Индекс для paid-лидов (аналогичный idx_leads_label_sync)
CREATE INDEX IF NOT EXISTS idx_leads_paid_label_sync
  ON leads (user_account_id)
  WHERE is_paid = true
    AND (whatsapp_paid_label_synced IS NULL OR whatsapp_paid_label_synced = false)
    AND chat_id IS NOT NULL
    AND source_type = 'whatsapp';
