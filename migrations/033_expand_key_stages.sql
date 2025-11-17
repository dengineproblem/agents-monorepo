-- Миграция: Расширение системы ключевых этапов с 1 до 3
-- Дата: 2025-11-17
-- Описание: Переименование существующего ключевого этапа в key_stage_1 и добавление
--           key_stage_2 и key_stage_3. Каждый этап имеет свой флаг reached_key_stage_N
--           с логикой "once qualified, always qualified".

-- =====================================================
-- РАСШИРЕНИЕ ТАБЛИЦЫ account_directions
-- =====================================================

DO $$
BEGIN
    -- 1. Переименовываем существующие колонки
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_directions' AND column_name = 'key_stage_pipeline_id'
    ) THEN
        ALTER TABLE account_directions
            RENAME COLUMN key_stage_pipeline_id TO key_stage_1_pipeline_id;

        ALTER TABLE account_directions
            RENAME COLUMN key_stage_status_id TO key_stage_1_status_id;

        RAISE NOTICE 'Переименованы key_stage_* → key_stage_1_*';
    END IF;

    -- 2. Добавляем колонки для второго ключевого этапа
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_directions' AND column_name = 'key_stage_2_pipeline_id'
    ) THEN
        ALTER TABLE account_directions
            ADD COLUMN key_stage_2_pipeline_id INTEGER,
            ADD COLUMN key_stage_2_status_id INTEGER;

        COMMENT ON COLUMN account_directions.key_stage_2_pipeline_id IS
            'ID воронки amoCRM для второго ключевого этапа (опционально)';
        COMMENT ON COLUMN account_directions.key_stage_2_status_id IS
            'ID этапа воронки amoCRM для второго ключевого этапа (опционально)';

        RAISE NOTICE 'Добавлены колонки для key_stage_2';
    END IF;

    -- 3. Добавляем колонки для третьего ключевого этапа
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_directions' AND column_name = 'key_stage_3_pipeline_id'
    ) THEN
        ALTER TABLE account_directions
            ADD COLUMN key_stage_3_pipeline_id INTEGER,
            ADD COLUMN key_stage_3_status_id INTEGER;

        COMMENT ON COLUMN account_directions.key_stage_3_pipeline_id IS
            'ID воронки amoCRM для третьего ключевого этапа (опционально)';
        COMMENT ON COLUMN account_directions.key_stage_3_status_id IS
            'ID этапа воронки amoCRM для третьего ключевого этапа (опционально)';

        RAISE NOTICE 'Добавлены колонки для key_stage_3';
    END IF;
END $$;

-- =====================================================
-- РАСШИРЕНИЕ ТАБЛИЦЫ leads
-- =====================================================

DO $$
BEGIN
    -- 1. Переименовываем существующий флаг
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = 'reached_key_stage'
    ) THEN
        ALTER TABLE leads
            RENAME COLUMN reached_key_stage TO reached_key_stage_1;

        RAISE NOTICE 'Переименован reached_key_stage → reached_key_stage_1';
    END IF;

    -- 2. Добавляем флаг для второго ключевого этапа
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = 'reached_key_stage_2'
    ) THEN
        ALTER TABLE leads
            ADD COLUMN reached_key_stage_2 BOOLEAN DEFAULT false;

        COMMENT ON COLUMN leads.reached_key_stage_2 IS
            'Флаг достижения второго ключевого этапа. Устанавливается один раз при достижении key_stage_2 и никогда не сбрасывается.';

        RAISE NOTICE 'Добавлен флаг reached_key_stage_2';
    END IF;

    -- 3. Добавляем флаг для третьего ключевого этапа
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = 'reached_key_stage_3'
    ) THEN
        ALTER TABLE leads
            ADD COLUMN reached_key_stage_3 BOOLEAN DEFAULT false;

        COMMENT ON COLUMN leads.reached_key_stage_3 IS
            'Флаг достижения третьего ключевого этапа. Устанавливается один раз при достижении key_stage_3 и никогда не сбрасывается.';

        RAISE NOTICE 'Добавлен флаг reached_key_stage_3';
    END IF;
END $$;

-- =====================================================
-- ОБНОВЛЕНИЕ ИНДЕКСОВ
-- =====================================================

-- Удаляем старые индексы если существуют
DROP INDEX IF EXISTS idx_account_directions_key_stage;
DROP INDEX IF EXISTS idx_leads_reached_key_stage;
DROP INDEX IF EXISTS idx_leads_qualification_stats;

-- Индексы для account_directions (все 3 ключевых этапа)
CREATE INDEX IF NOT EXISTS idx_account_directions_key_stage_1
    ON account_directions(user_account_id, key_stage_1_pipeline_id, key_stage_1_status_id)
    WHERE key_stage_1_pipeline_id IS NOT NULL AND key_stage_1_status_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_directions_key_stage_2
    ON account_directions(user_account_id, key_stage_2_pipeline_id, key_stage_2_status_id)
    WHERE key_stage_2_pipeline_id IS NOT NULL AND key_stage_2_status_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_directions_key_stage_3
    ON account_directions(user_account_id, key_stage_3_pipeline_id, key_stage_3_status_id)
    WHERE key_stage_3_pipeline_id IS NOT NULL AND key_stage_3_status_id IS NOT NULL;

-- Индексы для leads (все 3 флага)
CREATE INDEX IF NOT EXISTS idx_leads_reached_key_stage_1
    ON leads(user_account_id, direction_id, reached_key_stage_1)
    WHERE reached_key_stage_1 = true;

CREATE INDEX IF NOT EXISTS idx_leads_reached_key_stage_2
    ON leads(user_account_id, direction_id, reached_key_stage_2)
    WHERE reached_key_stage_2 = true;

CREATE INDEX IF NOT EXISTS idx_leads_reached_key_stage_3
    ON leads(user_account_id, direction_id, reached_key_stage_3)
    WHERE reached_key_stage_3 = true;

-- Composite индексы для статистики квалификации по креативам (все 3 этапа)
CREATE INDEX IF NOT EXISTS idx_leads_qualification_stats_1
    ON leads(user_account_id, direction_id, creative_id, reached_key_stage_1, created_at)
    WHERE reached_key_stage_1 = true;

CREATE INDEX IF NOT EXISTS idx_leads_qualification_stats_2
    ON leads(user_account_id, direction_id, creative_id, reached_key_stage_2, created_at)
    WHERE reached_key_stage_2 = true;

CREATE INDEX IF NOT EXISTS idx_leads_qualification_stats_3
    ON leads(user_account_id, direction_id, creative_id, reached_key_stage_3, created_at)
    WHERE reached_key_stage_3 = true;

-- =====================================================
-- УДАЛЕНИЕ СТАРЫХ CONSTRAINTS
-- =====================================================

DO $$
BEGIN
    -- Удаляем старый constraint если существует
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'check_key_stage_complete'
        AND table_name = 'account_directions'
    ) THEN
        ALTER TABLE account_directions
            DROP CONSTRAINT check_key_stage_complete;

        RAISE NOTICE 'Удален старый constraint check_key_stage_complete';
    END IF;
END $$;

-- Новые constraints: для каждого этапа оба поля должны быть либо NULL либо NOT NULL
ALTER TABLE account_directions
    ADD CONSTRAINT check_key_stage_1_complete
    CHECK (
        (key_stage_1_pipeline_id IS NULL AND key_stage_1_status_id IS NULL)
        OR
        (key_stage_1_pipeline_id IS NOT NULL AND key_stage_1_status_id IS NOT NULL)
    );

ALTER TABLE account_directions
    ADD CONSTRAINT check_key_stage_2_complete
    CHECK (
        (key_stage_2_pipeline_id IS NULL AND key_stage_2_status_id IS NULL)
        OR
        (key_stage_2_pipeline_id IS NOT NULL AND key_stage_2_status_id IS NOT NULL)
    );

ALTER TABLE account_directions
    ADD CONSTRAINT check_key_stage_3_complete
    CHECK (
        (key_stage_3_pipeline_id IS NULL AND key_stage_3_status_id IS NULL)
        OR
        (key_stage_3_pipeline_id IS NOT NULL AND key_stage_3_status_id IS NOT NULL)
    );

-- =====================================================
-- СТАТИСТИКА МИГРАЦИИ
-- =====================================================

DO $$
DECLARE
    total_directions INTEGER;
    directions_with_stage_1 INTEGER;
    total_leads INTEGER;
    leads_with_stage_1 INTEGER;
BEGIN
    -- Статистика по направлениям
    SELECT COUNT(*) INTO total_directions FROM account_directions;
    SELECT COUNT(*) INTO directions_with_stage_1
    FROM account_directions
    WHERE key_stage_1_pipeline_id IS NOT NULL;

    -- Статистика по лидам
    SELECT COUNT(*) INTO total_leads FROM leads;
    SELECT COUNT(*) INTO leads_with_stage_1
    FROM leads
    WHERE reached_key_stage_1 = true;

    RAISE NOTICE '=== СТАТИСТИКА МИГРАЦИИ 033 ===';
    RAISE NOTICE 'Направлений всего: %', total_directions;
    RAISE NOTICE 'Направлений с key_stage_1: %', directions_with_stage_1;
    RAISE NOTICE 'Лидов всего: %', total_leads;
    RAISE NOTICE 'Лидов достигших key_stage_1: %', leads_with_stage_1;
    RAISE NOTICE 'Процент квалификации по КЭ1: %%%',
        ROUND((leads_with_stage_1::NUMERIC / NULLIF(total_leads, 0)) * 100, 2);
END $$;

-- =====================================================
-- ПРИМЕЧАНИЕ
-- =====================================================

/*
ВАЖНО: Система с тремя ключевыми этапами

Теперь для каждого направления можно настроить до 3 ключевых этапов:
- key_stage_1: первый ключевой этап (обычно первая важная квалификация)
- key_stage_2: второй ключевой этап (промежуточный)
- key_stage_3: третий ключевой этап (обычно финальная конверсия)

Все этапы ОПЦИОНАЛЬНЫ - можно настроить 0, 1, 2 или 3 этапа.
Порядок этапов произвольный - пользователь выбирает любые этапы без ограничений.

Флаги reached_key_stage_1/2/3:
- Устанавливаются независимо друг от друга
- Каждый флаг работает по логике "once qualified, always qualified"
- Никогда не сбрасываются после установки

Обновление флагов происходит в:
1. amocrmWebhooks.ts - при получении webhook о смене статуса
2. amocrmLeadsSync.ts - при синхронизации лидов из amoCRM
3. POST /amocrm/recalculate-key-stage - при ручном пересчете

Для пересчета флагов используйте:
  POST /amocrm/recalculate-key-stage?userAccountId=UUID&directionId=UUID
*/
