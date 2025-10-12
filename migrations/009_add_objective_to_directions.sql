-- Миграция: Добавление поля objective в account_directions
-- Дата: 2025-10-12
-- Описание: Модифицируем существующую таблицу вместо пересоздания

-- =====================================================
-- ДОБАВЛЯЕМ ПОЛЕ objective
-- =====================================================

-- Добавляем поле objective (если его нет)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'account_directions' AND column_name = 'objective'
  ) THEN
    -- Добавляем поле с временным дефолтом
    ALTER TABLE account_directions
      ADD COLUMN objective TEXT DEFAULT 'whatsapp';
    
    -- Делаем поле обязательным
    ALTER TABLE account_directions
      ALTER COLUMN objective SET NOT NULL;
    
    -- Добавляем constraint
    ALTER TABLE account_directions
      ADD CONSTRAINT check_objective CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads'));
    
    -- Убираем дефолт (клиент должен явно выбирать)
    ALTER TABLE account_directions
      ALTER COLUMN objective DROP DEFAULT;
    
    COMMENT ON COLUMN account_directions.objective IS 'Тип кампании: whatsapp, instagram_traffic, site_leads';
  END IF;
END $$;

-- =====================================================
-- ДОБАВЛЯЕМ ИНДЕКС
-- =====================================================

-- Индекс для быстрого поиска по objective
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_account_directions_objective'
  ) THEN
    CREATE INDEX idx_account_directions_objective ON account_directions(user_account_id, objective);
  END IF;
END $$;

-- =====================================================
-- ОБНОВЛЯЕМ СУЩЕСТВУЮЩИЕ ЗАПИСИ (если есть)
-- =====================================================

-- Если в базе уже есть направления без objective, ставим дефолтное значение
-- Обновляем на основе fb_campaign_id или просто ставим 'whatsapp'
UPDATE account_directions
SET objective = 'whatsapp'
WHERE objective IS NULL;

-- =====================================================
-- ПРИМЕЧАНИЕ
-- =====================================================

/*
Теперь структура account_directions:
- id
- user_account_id
- name
- objective ← НОВОЕ ПОЛЕ
- fb_campaign_id
- campaign_status
- daily_budget_cents
- target_cpl_cents
- is_active
- created_at
- updated_at

Каждое направление теперь имеет явный objective (whatsapp, instagram_traffic, site_leads).
При создании направления через API клиент выбирает objective.
Название кампании: "[{name}] {objective_readable}"
*/

