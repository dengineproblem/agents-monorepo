-- Миграция: Добавление ключевых этапов Bitrix24 в account_directions
-- Дата: 2025-01-27
-- Описание: Добавляет колонки для хранения до 3 ключевых этапов Bitrix24.
--           status_id имеет тип TEXT (Bitrix24 использует "NEW", "C1:NEW" и т.д.)

-- =====================================================
-- РАСШИРЕНИЕ ТАБЛИЦЫ account_directions
-- =====================================================

DO $$
BEGIN
    -- 1. Добавляем колонки для первого ключевого этапа Bitrix24
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_directions' AND column_name = 'bitrix24_key_stage_1_category_id'
    ) THEN
        ALTER TABLE account_directions
            ADD COLUMN bitrix24_key_stage_1_category_id INTEGER,
            ADD COLUMN bitrix24_key_stage_1_status_id TEXT;

        COMMENT ON COLUMN account_directions.bitrix24_key_stage_1_category_id IS
            'ID категории/воронки Bitrix24 для первого ключевого этапа';
        COMMENT ON COLUMN account_directions.bitrix24_key_stage_1_status_id IS
            'ID статуса Bitrix24 для первого ключевого этапа (например "NEW", "C1:NEW")';

        RAISE NOTICE 'Добавлены колонки для bitrix24_key_stage_1';
    END IF;

    -- 2. Добавляем колонки для второго ключевого этапа Bitrix24
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_directions' AND column_name = 'bitrix24_key_stage_2_category_id'
    ) THEN
        ALTER TABLE account_directions
            ADD COLUMN bitrix24_key_stage_2_category_id INTEGER,
            ADD COLUMN bitrix24_key_stage_2_status_id TEXT;

        COMMENT ON COLUMN account_directions.bitrix24_key_stage_2_category_id IS
            'ID категории/воронки Bitrix24 для второго ключевого этапа';
        COMMENT ON COLUMN account_directions.bitrix24_key_stage_2_status_id IS
            'ID статуса Bitrix24 для второго ключевого этапа';

        RAISE NOTICE 'Добавлены колонки для bitrix24_key_stage_2';
    END IF;

    -- 3. Добавляем колонки для третьего ключевого этапа Bitrix24
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_directions' AND column_name = 'bitrix24_key_stage_3_category_id'
    ) THEN
        ALTER TABLE account_directions
            ADD COLUMN bitrix24_key_stage_3_category_id INTEGER,
            ADD COLUMN bitrix24_key_stage_3_status_id TEXT;

        COMMENT ON COLUMN account_directions.bitrix24_key_stage_3_category_id IS
            'ID категории/воронки Bitrix24 для третьего ключевого этапа';
        COMMENT ON COLUMN account_directions.bitrix24_key_stage_3_status_id IS
            'ID статуса Bitrix24 для третьего ключевого этапа';

        RAISE NOTICE 'Добавлены колонки для bitrix24_key_stage_3';
    END IF;
END $$;

-- =====================================================
-- ИНДЕКСЫ
-- =====================================================

-- Индексы для поиска направлений с настроенными ключевыми этапами Bitrix24
CREATE INDEX IF NOT EXISTS idx_account_directions_bitrix24_key_stage_1
    ON account_directions(user_account_id, bitrix24_key_stage_1_category_id, bitrix24_key_stage_1_status_id)
    WHERE bitrix24_key_stage_1_category_id IS NOT NULL AND bitrix24_key_stage_1_status_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_directions_bitrix24_key_stage_2
    ON account_directions(user_account_id, bitrix24_key_stage_2_category_id, bitrix24_key_stage_2_status_id)
    WHERE bitrix24_key_stage_2_category_id IS NOT NULL AND bitrix24_key_stage_2_status_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_directions_bitrix24_key_stage_3
    ON account_directions(user_account_id, bitrix24_key_stage_3_category_id, bitrix24_key_stage_3_status_id)
    WHERE bitrix24_key_stage_3_category_id IS NOT NULL AND bitrix24_key_stage_3_status_id IS NOT NULL;

-- =====================================================
-- CONSTRAINTS
-- =====================================================

-- Для каждого этапа: оба поля должны быть либо NULL, либо NOT NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'check_bitrix24_key_stage_1_complete'
        AND table_name = 'account_directions'
    ) THEN
        ALTER TABLE account_directions
            ADD CONSTRAINT check_bitrix24_key_stage_1_complete
            CHECK (
                (bitrix24_key_stage_1_category_id IS NULL AND bitrix24_key_stage_1_status_id IS NULL)
                OR
                (bitrix24_key_stage_1_category_id IS NOT NULL AND bitrix24_key_stage_1_status_id IS NOT NULL)
            );
        RAISE NOTICE 'Добавлен constraint check_bitrix24_key_stage_1_complete';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'check_bitrix24_key_stage_2_complete'
        AND table_name = 'account_directions'
    ) THEN
        ALTER TABLE account_directions
            ADD CONSTRAINT check_bitrix24_key_stage_2_complete
            CHECK (
                (bitrix24_key_stage_2_category_id IS NULL AND bitrix24_key_stage_2_status_id IS NULL)
                OR
                (bitrix24_key_stage_2_category_id IS NOT NULL AND bitrix24_key_stage_2_status_id IS NOT NULL)
            );
        RAISE NOTICE 'Добавлен constraint check_bitrix24_key_stage_2_complete';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'check_bitrix24_key_stage_3_complete'
        AND table_name = 'account_directions'
    ) THEN
        ALTER TABLE account_directions
            ADD CONSTRAINT check_bitrix24_key_stage_3_complete
            CHECK (
                (bitrix24_key_stage_3_category_id IS NULL AND bitrix24_key_stage_3_status_id IS NULL)
                OR
                (bitrix24_key_stage_3_category_id IS NOT NULL AND bitrix24_key_stage_3_status_id IS NOT NULL)
            );
        RAISE NOTICE 'Добавлен constraint check_bitrix24_key_stage_3_complete';
    END IF;
END $$;

-- =====================================================
-- СТАТИСТИКА МИГРАЦИИ
-- =====================================================

DO $$
DECLARE
    total_directions INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_directions FROM account_directions;

    RAISE NOTICE '=== СТАТИСТИКА МИГРАЦИИ 103 ===';
    RAISE NOTICE 'Направлений всего: %', total_directions;
    RAISE NOTICE 'Добавлены колонки bitrix24_key_stage_1/2/3_category_id и bitrix24_key_stage_1/2/3_status_id';
END $$;

-- =====================================================
-- ПРИМЕЧАНИЕ
-- =====================================================

/*
ВАЖНО: Ключевые этапы Bitrix24

Для каждого направления можно настроить до 3 ключевых этапов Bitrix24:
- bitrix24_key_stage_1: первый ключевой этап
- bitrix24_key_stage_2: второй ключевой этап
- bitrix24_key_stage_3: третий ключевой этап

Отличия от AmoCRM:
- category_id вместо pipeline_id (терминология Bitrix24)
- status_id имеет тип TEXT (Bitrix24: "NEW", "C1:NEW", "WON")
- В AmoCRM status_id INTEGER

Флаги reached_key_stage_1/2/3 в таблице leads используются общие
для AmoCRM и Bitrix24 - они уже существуют из миграции 033.

Обновление флагов происходит в:
1. bitrix24Webhooks.ts - при получении webhook о смене статуса
2. POST /bitrix24/recalculate-key-stage-stats - при ручном пересчете
*/
