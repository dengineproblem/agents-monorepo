-- Миграция: Добавление WABA поддержки для Meta Cloud API
-- Дата: 2025-01-24
-- Описание: Позволяет выбирать тип подключения WhatsApp (Evolution или WABA)

-- =====================================================
-- 1. Добавить поле connection_type
-- =====================================================

ALTER TABLE whatsapp_phone_numbers
ADD COLUMN IF NOT EXISTS connection_type VARCHAR(20) DEFAULT 'evolution';

-- Constraint для валидных значений
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_phone_numbers_connection_type_check'
  ) THEN
    ALTER TABLE whatsapp_phone_numbers
    ADD CONSTRAINT whatsapp_phone_numbers_connection_type_check
    CHECK (connection_type IN ('evolution', 'waba'));
  END IF;
END $$;

COMMENT ON COLUMN whatsapp_phone_numbers.connection_type IS
'Тип подключения: evolution (серый WhatsApp с QR) или waba (официальный Meta Cloud API)';

-- =====================================================
-- 2. Добавить поле waba_phone_id
-- =====================================================

ALTER TABLE whatsapp_phone_numbers
ADD COLUMN IF NOT EXISTS waba_phone_id VARCHAR(50);

COMMENT ON COLUMN whatsapp_phone_numbers.waba_phone_id IS
'Meta Cloud API Phone Number ID. Можно найти в Meta Business Suite → WhatsApp Manager → Phone Numbers';

-- =====================================================
-- 3. Индекс для быстрого поиска по waba_phone_id
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_whatsapp_phone_numbers_waba_phone_id
ON whatsapp_phone_numbers(waba_phone_id)
WHERE waba_phone_id IS NOT NULL;

-- =====================================================
-- 4. Индекс по connection_type для фильтрации
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_whatsapp_phone_numbers_connection_type
ON whatsapp_phone_numbers(connection_type);
