-- Миграция: Добавление ключевого этапа воронки для направлений
-- Дата: 2025-11-15
-- Описание: Позволяет каждому направлению выбрать свой ключевой этап (key stage)
--           для отслеживания "процента квалов" - процента лидов достигших этого этапа

-- =====================================================
-- ДОБАВЛЕНИЕ КОЛОНОК В account_directions
-- =====================================================

DO $$
BEGIN
    -- Добавляем key_stage_pipeline_id если не существует
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_directions' AND column_name = 'key_stage_pipeline_id'
    ) THEN
        ALTER TABLE account_directions
            ADD COLUMN key_stage_pipeline_id INTEGER;

        COMMENT ON COLUMN account_directions.key_stage_pipeline_id IS 'ID воронки amoCRM, содержащей ключевой этап квалификации лидов для этого направления';
    END IF;

    -- Добавляем key_stage_status_id если не существует
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_directions' AND column_name = 'key_stage_status_id'
    ) THEN
        ALTER TABLE account_directions
            ADD COLUMN key_stage_status_id INTEGER;

        COMMENT ON COLUMN account_directions.key_stage_status_id IS 'ID этапа воронки amoCRM, который считается ключевым для квалификации (например "Оплата получена")';
    END IF;
END $$;

-- =====================================================
-- ИНДЕКСЫ
-- =====================================================

-- Индекс для быстрого поиска directions с настроенным key stage
CREATE INDEX IF NOT EXISTS idx_account_directions_key_stage
    ON account_directions(user_account_id, key_stage_pipeline_id, key_stage_status_id)
    WHERE key_stage_pipeline_id IS NOT NULL AND key_stage_status_id IS NOT NULL;

-- =====================================================
-- CONSTRAINTS
-- =====================================================

-- Добавляем constraint: если указан key_stage_pipeline_id, то должен быть указан и key_stage_status_id (и наоборот)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'check_key_stage_complete'
    ) THEN
        ALTER TABLE account_directions
            ADD CONSTRAINT check_key_stage_complete
            CHECK (
                (key_stage_pipeline_id IS NULL AND key_stage_status_id IS NULL) OR
                (key_stage_pipeline_id IS NOT NULL AND key_stage_status_id IS NOT NULL)
            );
    END IF;
END $$;

-- =====================================================
-- ПРИМЕЧАНИЕ
-- =====================================================

/*
Ключевой этап (key stage) - это конкретный этап воронки amoCRM, достижение которого
считается "квалификацией" лида для данного направления.

Примеры ключевых этапов:
- "Оплата получена" (status_id=142) - для B2C продуктов
- "Консультация проведена" - для консультационных услуг
- "Договор подписан" - для B2B сделок
- "Презентация проведена" - для сложных продаж

Процент квалов рассчитывается как:
  (Лиды достигшие key_stage) / (Всего лидов) × 100%

Каждое направление может иметь свой key stage, так как разные продукты/услуги
могут иметь разные критерии квалификации.

NULL значения означают что key stage не настроен для этого direction.
В этом случае в ROI Analytics будет показываться "Не настроено".
*/
