-- Миграция: Таблица для pre-created TikTok ad groups
-- Дата: 2025-12-24
-- Описание: Хранит связи между направлениями и заранее созданными TikTok ad groups.
--           Аналог direction_adsets для TikTok.
--           Используется в режиме use_existing для работы с ad groups,
--           созданными вручную в TikTok Ads Manager.

-- =====================================================
-- 1. Создание таблицы
-- =====================================================

CREATE TABLE direction_tiktok_adgroups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Связь с направлением
  direction_id UUID NOT NULL REFERENCES account_directions(id) ON DELETE CASCADE,

  -- TikTok Ad Group ID (созданный вручную в TikTok Ads Manager)
  tiktok_adgroup_id TEXT NOT NULL,

  -- Метаданные ad group (синхронизируются из TikTok)
  adgroup_name TEXT,
  daily_budget DECIMAL(10, 2),  -- TikTok использует доллары, не центы
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
  CONSTRAINT unique_tiktok_adgroup_per_direction UNIQUE (direction_id, tiktok_adgroup_id),
  CONSTRAINT check_tiktok_ads_count CHECK (ads_count >= 0),
  CONSTRAINT check_tiktok_status CHECK (status IN ('ENABLE', 'DISABLE', 'DELETE'))
);

-- =====================================================
-- 2. Комментарии
-- =====================================================

COMMENT ON TABLE direction_tiktok_adgroups IS
  'Pre-created ad groups для TikTok в режиме use_existing.
   Ad groups создаются вручную в TikTok Ads Manager, затем привязываются к направлениям.';

COMMENT ON COLUMN direction_tiktok_adgroups.tiktok_adgroup_id IS
  'ID ad group из TikTok (формат: 1234567890123456789)';

COMMENT ON COLUMN direction_tiktok_adgroups.ads_count IS
  'Количество ads в ad group. Используется для soft limit (50 ads).
   Обновляется при каждом добавлении ads через наше приложение.';

COMMENT ON COLUMN direction_tiktok_adgroups.last_used_at IS
  'Timestamp последней активации ad group.
   NULL = еще не использовался (DISABLE since creation).';

COMMENT ON COLUMN direction_tiktok_adgroups.status IS
  'Статус ad group в TikTok: ENABLE (активен), DISABLE (остановлен), DELETE (удалён)';

-- =====================================================
-- 3. Индексы для производительности
-- =====================================================

-- Основной индекс для поиска по направлению
CREATE INDEX idx_direction_tiktok_adgroups_direction
  ON direction_tiktok_adgroups(direction_id)
  WHERE is_active = true;

-- Индекс для поиска по TikTok ID
CREATE INDEX idx_direction_tiktok_adgroups_tiktok
  ON direction_tiktok_adgroups(tiktok_adgroup_id);

-- Индекс для фильтрации по статусу
CREATE INDEX idx_direction_tiktok_adgroups_status
  ON direction_tiktok_adgroups(direction_id, status)
  WHERE is_active = true;

-- Оптимизированный индекс для поиска доступных ad groups
-- (DISABLE статус, меньше 50 ads)
CREATE INDEX idx_direction_tiktok_adgroups_available
  ON direction_tiktok_adgroups(direction_id, ads_count)
  WHERE is_active = true AND status = 'DISABLE' AND ads_count < 50;

-- =====================================================
-- 4. Триггер для автоматического обновления updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_direction_tiktok_adgroups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_direction_tiktok_adgroups_updated_at
  BEFORE UPDATE ON direction_tiktok_adgroups
  FOR EACH ROW
  EXECUTE FUNCTION update_direction_tiktok_adgroups_updated_at();

-- =====================================================
-- 5. RLS (Row Level Security) - как для account_directions
-- =====================================================

ALTER TABLE direction_tiktok_adgroups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own direction_tiktok_adgroups"
  ON direction_tiktok_adgroups FOR SELECT
  USING (
    direction_id IN (
      SELECT id FROM account_directions
      WHERE user_account_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own direction_tiktok_adgroups"
  ON direction_tiktok_adgroups FOR INSERT
  WITH CHECK (
    direction_id IN (
      SELECT id FROM account_directions
      WHERE user_account_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own direction_tiktok_adgroups"
  ON direction_tiktok_adgroups FOR UPDATE
  USING (
    direction_id IN (
      SELECT id FROM account_directions
      WHERE user_account_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own direction_tiktok_adgroups"
  ON direction_tiktok_adgroups FOR DELETE
  USING (
    direction_id IN (
      SELECT id FROM account_directions
      WHERE user_account_id = auth.uid()
    )
  );

-- =====================================================
-- 6. RPC функция для атомарного инкремента ads_count
-- =====================================================

CREATE OR REPLACE FUNCTION increment_tiktok_ads_count(
  p_tiktok_adgroup_id TEXT,
  p_count INTEGER
) RETURNS INTEGER AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE direction_tiktok_adgroups
  SET ads_count = ads_count + p_count
  WHERE tiktok_adgroup_id = p_tiktok_adgroup_id
  RETURNING ads_count INTO new_count;

  RETURN new_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_tiktok_ads_count IS
  'Атомарно увеличивает счетчик ads в TikTok ad group.
   Используется после успешного добавления ads через TikTok API.';

-- =====================================================
-- 7. Добавляем TikTok поля в account_directions (если нет)
-- =====================================================

-- TikTok-специфичные настройки для направления
ALTER TABLE account_directions
  ADD COLUMN IF NOT EXISTS tiktok_pixel_id TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_identity_id TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_campaign_id TEXT;

COMMENT ON COLUMN account_directions.tiktok_pixel_id IS
  'TikTok Pixel ID для tracking конверсий';

COMMENT ON COLUMN account_directions.tiktok_identity_id IS
  'TikTok Identity ID (TT_USER) для брендированных ads';

COMMENT ON COLUMN account_directions.tiktok_campaign_id IS
  'ID кампании TikTok, связанной с направлением';

-- =====================================================
-- Готово! Таблица создана с полной поддержкой безопасности
-- =====================================================
