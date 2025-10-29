-- Миграция: Добавление полей instance_name и connection_status в whatsapp_phone_numbers
-- Дата: 2025-10-29
-- Описание: Добавляет поля для связи с WhatsApp instances и отображения статуса на фронте

-- =====================================================
-- 1. Добавить колонки instance_name и connection_status
-- =====================================================

-- Добавить instance_name (если не существует)
ALTER TABLE whatsapp_phone_numbers
ADD COLUMN IF NOT EXISTS instance_name TEXT;

-- Добавить connection_status (если не существует)
ALTER TABLE whatsapp_phone_numbers
ADD COLUMN IF NOT EXISTS connection_status TEXT;

-- Добавить ограничение на connection_status
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'whatsapp_phone_numbers_connection_status_check'
    ) THEN
        ALTER TABLE whatsapp_phone_numbers
        ADD CONSTRAINT whatsapp_phone_numbers_connection_status_check
        CHECK (connection_status IN ('connecting', 'connected', 'disconnected') OR connection_status IS NULL);
    END IF;
END $$;

-- Добавить комментарии
COMMENT ON COLUMN whatsapp_phone_numbers.instance_name IS 'Имя инстанса WhatsApp в Evolution API';
COMMENT ON COLUMN whatsapp_phone_numbers.connection_status IS 'Статус подключения: connecting, connected, disconnected';

-- =====================================================
-- 2. Создать индекс для быстрого поиска по instance_name
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_instance
  ON whatsapp_phone_numbers(instance_name)
  WHERE instance_name IS NOT NULL;

-- =====================================================
-- 3. Синхронизировать существующие данные из whatsapp_instances
-- =====================================================

-- Обновить whatsapp_phone_numbers данными из whatsapp_instances
-- (если номер телефона совпадает)
UPDATE whatsapp_phone_numbers wpn
SET
  instance_name = wi.instance_name,
  connection_status = wi.status
FROM whatsapp_instances wi
WHERE
  wi.phone_number IS NOT NULL
  AND wpn.user_account_id = wi.user_account_id
  AND wpn.phone_number = wi.phone_number
  AND (wpn.instance_name IS NULL OR wpn.instance_name != wi.instance_name);
