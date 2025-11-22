-- Миграция: Таблица для pre-created ad sets
-- Дата: 2025-11-06
-- Описание: Хранит связи между направлениями и заранее созданными ad sets.
--           Используется в режиме use_existing для работы с ad sets,
--           созданными вручную в Facebook Ads Manager с конкретными WhatsApp номерами.

-- =====================================================
-- 1. Создание таблицы
-- =====================================================

CREATE TABLE direction_adsets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Связь с направлением
  direction_id UUID NOT NULL REFERENCES account_directions(id) ON DELETE CASCADE,
  
  -- Facebook Ad Set ID (созданный вручную в FB Ads Manager)
  fb_adset_id TEXT NOT NULL,
  
  -- Метаданные ad set (синхронизируются из Facebook)
  adset_name TEXT,
  daily_budget_cents INTEGER,
  status TEXT,
  
  -- Учет использования
  ads_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  
  -- Метаданные системы
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  
  -- Метаданные создания
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ограничения
  CONSTRAINT unique_adset_per_direction UNIQUE (direction_id, fb_adset_id),
  CONSTRAINT check_ads_count CHECK (ads_count >= 0),
  CONSTRAINT check_status CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED'))
);

-- =====================================================
-- 2. Комментарии
-- =====================================================

COMMENT ON TABLE direction_adsets IS 
  'Pre-created ad sets для режима use_existing. 
   Ad sets создаются вручную в Facebook Ads Manager, затем привязываются к направлениям.';

COMMENT ON COLUMN direction_adsets.fb_adset_id IS 
  'ID ad set из Facebook (формат: 120232923985510449)';

COMMENT ON COLUMN direction_adsets.ads_count IS 
  'Количество ads в ad set. Используется для soft limit (50 ads).
   Обновляется при каждом добавлении ads через наше приложение.';

COMMENT ON COLUMN direction_adsets.last_used_at IS 
  'Timestamp последней активации ad set.
   NULL = еще не использовался (PAUSED since creation).';

COMMENT ON COLUMN direction_adsets.status IS 
  'Статус ad set в Facebook: ACTIVE (сейчас используется), PAUSED (доступен для использования), ARCHIVED, DELETED';

-- =====================================================
-- 3. Индексы для производительности
-- =====================================================

-- Основной индекс для поиска по направлению
CREATE INDEX idx_direction_adsets_direction 
  ON direction_adsets(direction_id) 
  WHERE is_active = true;

-- Индекс для поиска по Facebook ID
CREATE INDEX idx_direction_adsets_fb 
  ON direction_adsets(fb_adset_id);

-- Индекс для фильтрации по статусу
CREATE INDEX idx_direction_adsets_status 
  ON direction_adsets(direction_id, status) 
  WHERE is_active = true;

-- Оптимизированный индекс для поиска доступных ad sets
-- (PAUSED статус, меньше 50 ads)
CREATE INDEX idx_direction_adsets_available 
  ON direction_adsets(direction_id, ads_count) 
  WHERE is_active = true AND status = 'PAUSED' AND ads_count < 50;

-- =====================================================
-- 4. Триггер для автоматического обновления updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_direction_adsets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_direction_adsets_updated_at
  BEFORE UPDATE ON direction_adsets
  FOR EACH ROW
  EXECUTE FUNCTION update_direction_adsets_updated_at();

-- =====================================================
-- 5. RLS (Row Level Security) - как для account_directions
-- =====================================================

ALTER TABLE direction_adsets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own direction_adsets"
  ON direction_adsets FOR SELECT
  USING (
    direction_id IN (
      SELECT id FROM account_directions 
      WHERE user_account_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own direction_adsets"
  ON direction_adsets FOR INSERT
  WITH CHECK (
    direction_id IN (
      SELECT id FROM account_directions 
      WHERE user_account_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own direction_adsets"
  ON direction_adsets FOR UPDATE
  USING (
    direction_id IN (
      SELECT id FROM account_directions 
      WHERE user_account_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own direction_adsets"
  ON direction_adsets FOR DELETE
  USING (
    direction_id IN (
      SELECT id FROM account_directions 
      WHERE user_account_id = auth.uid()
    )
  );

-- =====================================================
-- 6. RPC функция для атомарного инкремента ads_count
-- =====================================================

CREATE OR REPLACE FUNCTION increment_ads_count(
  p_fb_adset_id TEXT,
  p_count INTEGER
) RETURNS INTEGER AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE direction_adsets
  SET ads_count = ads_count + p_count
  WHERE fb_adset_id = p_fb_adset_id
  RETURNING ads_count INTO new_count;
  
  RETURN new_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_ads_count IS 
  'Атомарно увеличивает счетчик ads в ad set. 
   Используется после успешного добавления ads через Facebook API.';

-- =====================================================
-- Готово! Таблица создана с полной поддержкой безопасности
-- =====================================================







