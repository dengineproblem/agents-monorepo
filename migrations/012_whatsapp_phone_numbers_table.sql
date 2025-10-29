-- Миграция: Множественные WhatsApp номера с привязкой к направлениям
-- Дата: 2025-10-24
-- Описание: Позволяет пользователю иметь несколько WhatsApp номеров и привязывать их к направлениям

-- =====================================================
-- 1. Таблица WhatsApp номеров
-- =====================================================

CREATE TABLE IF NOT EXISTS whatsapp_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Номер телефона в международном формате
  phone_number TEXT NOT NULL CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  
  -- Название для удобства (опционально)
  label TEXT CHECK (label IS NULL OR char_length(label) <= 100),
  
  -- Статус
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  
  -- Метаданные
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Уникальность номера в пределах пользователя
  CONSTRAINT unique_phone_per_user UNIQUE (user_account_id, phone_number)
);

-- Комментарии
COMMENT ON TABLE whatsapp_phone_numbers IS 'Список WhatsApp номеров пользователя. Каждый номер можно привязать к направлению.';
COMMENT ON COLUMN whatsapp_phone_numbers.phone_number IS 'Номер в международном формате, например: +12345678901';
COMMENT ON COLUMN whatsapp_phone_numbers.label IS 'Название для удобства, например: "Основной", "Для клиник"';
COMMENT ON COLUMN whatsapp_phone_numbers.is_default IS 'Дефолтный номер для новых направлений';

-- Индексы
CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_user 
  ON whatsapp_phone_numbers(user_account_id) 
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_default 
  ON whatsapp_phone_numbers(user_account_id, is_default) 
  WHERE is_default = true;

-- =====================================================
-- 2. Триггер: обновление updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_whatsapp_phone_numbers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_whatsapp_phone_numbers_updated_at ON whatsapp_phone_numbers;
CREATE TRIGGER trigger_update_whatsapp_phone_numbers_updated_at
  BEFORE UPDATE ON whatsapp_phone_numbers
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_phone_numbers_updated_at();

-- =====================================================
-- 3. Триггер: только один дефолтный номер на пользователя
-- =====================================================

CREATE OR REPLACE FUNCTION ensure_single_default_whatsapp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    -- Убираем is_default у всех других номеров этого пользователя
    UPDATE whatsapp_phone_numbers
    SET is_default = false
    WHERE user_account_id = NEW.user_account_id
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ensure_single_default_whatsapp ON whatsapp_phone_numbers;
CREATE TRIGGER trigger_ensure_single_default_whatsapp
  BEFORE INSERT OR UPDATE ON whatsapp_phone_numbers
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_default_whatsapp();

-- =====================================================
-- 4. Добавляем колонку в account_directions
-- =====================================================

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='account_directions' AND column_name='whatsapp_phone_number_id') THEN
        ALTER TABLE account_directions 
        ADD COLUMN whatsapp_phone_number_id UUID REFERENCES whatsapp_phone_numbers(id) ON DELETE SET NULL;
        
        COMMENT ON COLUMN account_directions.whatsapp_phone_number_id IS 'FK на whatsapp_phone_numbers. NULL = использовать дефолтный или из user_accounts.';
    END IF;
END $$;

-- Индекс для быстрого поиска направлений по номеру
CREATE INDEX IF NOT EXISTS idx_directions_whatsapp_number 
  ON account_directions(whatsapp_phone_number_id) 
  WHERE whatsapp_phone_number_id IS NOT NULL;

-- =====================================================
-- 5. Миграция существующих данных
-- =====================================================

-- Для каждого пользователя с whatsapp_phone_number в user_accounts:
-- 1. Создаём запись в whatsapp_phone_numbers (если номер валидный)
-- 2. Помечаем её как дефолтную
-- 3. Не трогаем колонку в user_accounts (для обратной совместимости)

DO $$
DECLARE
  user_rec RECORD;
  new_number_id UUID;
BEGIN
  FOR user_rec IN 
    SELECT id, whatsapp_phone_number
    FROM user_accounts
    WHERE whatsapp_phone_number IS NOT NULL
      AND whatsapp_phone_number ~ '^\+[1-9][0-9]{7,14}$'  -- валидный формат
      AND NOT EXISTS (
        SELECT 1 FROM whatsapp_phone_numbers 
        WHERE user_account_id = user_accounts.id
      )
  LOOP
    -- Создаём запись для номера из user_accounts
    INSERT INTO whatsapp_phone_numbers (
      user_account_id,
      phone_number,
      label,
      is_default,
      is_active
    ) VALUES (
      user_rec.id,
      user_rec.whatsapp_phone_number,
      'Основной',
      true,  -- первый номер = дефолтный
      true
    )
    RETURNING id INTO new_number_id;
    
    RAISE NOTICE 'Создан WhatsApp номер % для пользователя %', new_number_id, user_rec.id;
  END LOOP;
END $$;

-- =====================================================
-- 6. RLS Policies (опционально, если нужны)
-- =====================================================

-- Отключаем RLS для упрощения (если используется service role)
ALTER TABLE whatsapp_phone_numbers DISABLE ROW LEVEL SECURITY;

-- Или включаем с политиками:
-- ALTER TABLE whatsapp_phone_numbers ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view own WhatsApp numbers"
--   ON whatsapp_phone_numbers
--   FOR SELECT
--   USING (user_account_id = auth.uid());

-- CREATE POLICY "Users can insert own WhatsApp numbers"
--   ON whatsapp_phone_numbers
--   FOR INSERT
--   WITH CHECK (user_account_id = auth.uid());

-- CREATE POLICY "Users can update own WhatsApp numbers"
--   ON whatsapp_phone_numbers
--   FOR UPDATE
--   USING (user_account_id = auth.uid());

-- CREATE POLICY "Users can delete own WhatsApp numbers"
--   ON whatsapp_phone_numbers
--   FOR DELETE
--   USING (user_account_id = auth.uid());





