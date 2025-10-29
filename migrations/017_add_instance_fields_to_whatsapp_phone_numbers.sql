-- Миграция: Добавление полей instance_name и connection_status в whatsapp_phone_numbers
-- Дата: 2025-10-29
-- Описание: Добавляет поля для связи с WhatsApp instances и отображения статуса на фронте

-- =====================================================
-- 1. Добавить колонки instance_name и connection_status
-- =====================================================

-- Добавить instance_name
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='whatsapp_phone_numbers' AND column_name='instance_name'
    ) THEN
        ALTER TABLE whatsapp_phone_numbers
        ADD COLUMN instance_name TEXT;
    END IF;
END $$;

COMMENT ON COLUMN whatsapp_phone_numbers.instance_name IS 'Имя инстанса WhatsApp в Evolution API';

-- Добавить connection_status
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='whatsapp_phone_numbers' AND column_name='connection_status'
    ) THEN
        ALTER TABLE whatsapp_phone_numbers
        ADD COLUMN connection_status TEXT CHECK (connection_status IN ('connecting', 'connected', 'disconnected') OR connection_status IS NULL);
    END IF;
END $$;

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
DO $$
DECLARE
  instance_rec RECORD;
BEGIN
  FOR instance_rec IN
    SELECT
      wi.instance_name,
      wi.status,
      wi.phone_number,
      wi.user_account_id
    FROM whatsapp_instances wi
    WHERE wi.phone_number IS NOT NULL
  LOOP
    -- Найти соответствующую запись в whatsapp_phone_numbers и обновить
    UPDATE whatsapp_phone_numbers
    SET
      instance_name = instance_rec.instance_name,
      connection_status = instance_rec.status
    WHERE
      user_account_id = instance_rec.user_account_id
      AND phone_number = instance_rec.phone_number
      AND (instance_name IS NULL OR instance_name != instance_rec.instance_name);

    IF FOUND THEN
      RAISE NOTICE 'Updated phone number % with instance %',
        instance_rec.phone_number, instance_rec.instance_name;
    END IF;
  END LOOP;
END $$;
