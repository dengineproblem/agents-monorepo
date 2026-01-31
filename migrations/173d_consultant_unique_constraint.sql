-- =============================================
-- Миграция 173d: Unique constraint для consultants.user_account_id
-- Описание: Очистка дубликатов и добавление уникального constraint
-- Дата: 2026-01-31
-- =============================================

-- 1. АНАЛИЗ ДУБЛИКАТОВ
-- =============================================

DO $$
DECLARE
    duplicate_count INTEGER;
    rec RECORD;
BEGIN
    -- Подсчитываем количество дубликатов
    SELECT COUNT(*)
    INTO duplicate_count
    FROM (
        SELECT user_account_id, COUNT(*) as cnt
        FROM consultants
        WHERE user_account_id IS NOT NULL
        GROUP BY user_account_id
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_count > 0 THEN
        RAISE NOTICE 'Найдено % user_account_id с дубликатами', duplicate_count;

        -- Выводим информацию о дубликатах
        RAISE NOTICE 'Дубликаты:';
        FOR rec IN (
            SELECT user_account_id, COUNT(*) as cnt, array_agg(id) as consultant_ids
            FROM consultants
            WHERE user_account_id IS NOT NULL
            GROUP BY user_account_id
            HAVING COUNT(*) > 1
        ) LOOP
            RAISE NOTICE '  user_account_id: %, консультантов: %, IDs: %',
                rec.user_account_id, rec.cnt, rec.consultant_ids;
        END LOOP;
    ELSE
        RAISE NOTICE 'Дубликатов не найдено';
    END IF;
END$$;

-- 2. ОЧИСТКА ДУБЛИКАТОВ
-- =============================================

DO $$
DECLARE
    total_cleared INTEGER := 0;
BEGIN
    -- Для каждого дублирующегося user_account_id оставляем только первого консультанта
    -- Остальным устанавливаем user_account_id в NULL
    WITH duplicate_accounts AS (
        SELECT user_account_id
        FROM consultants
        WHERE user_account_id IS NOT NULL
        GROUP BY user_account_id
        HAVING COUNT(*) > 1
    ),
    consultants_to_clear AS (
        SELECT c.id
        FROM consultants c
        INNER JOIN duplicate_accounts da ON c.user_account_id = da.user_account_id
        WHERE c.id NOT IN (
            -- Оставляем самого первого консультанта (по created_at или по id)
            SELECT DISTINCT ON (user_account_id) id
            FROM consultants
            WHERE user_account_id IN (SELECT user_account_id FROM duplicate_accounts)
            ORDER BY user_account_id, created_at ASC, id ASC
        )
    )
    UPDATE consultants
    SET user_account_id = NULL
    WHERE id IN (SELECT id FROM consultants_to_clear);

    GET DIAGNOSTICS total_cleared = ROW_COUNT;

    IF total_cleared > 0 THEN
        RAISE NOTICE 'Очищено user_account_id у % консультантов (оставлены только первые)', total_cleared;
    ELSE
        RAISE NOTICE 'Ничего не требовалось очищать';
    END IF;
END$$;

-- 3. ДОБАВЛЕНИЕ UNIQUE CONSTRAINT
-- =============================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_consultant_user_account'
    ) THEN
        ALTER TABLE consultants
        ADD CONSTRAINT unique_consultant_user_account UNIQUE (user_account_id);
        RAISE NOTICE 'Добавлен unique constraint на consultants.user_account_id';
    ELSE
        RAISE NOTICE 'Unique constraint уже существует';
    END IF;
END$$;

-- Обновляем комментарий
COMMENT ON COLUMN consultants.user_account_id IS 'Связь 1-to-1 с user_accounts (для логина консультанта). Уникально.';

-- =============================================
-- ЗАВЕРШЕНИЕ МИГРАЦИИ 173d
-- =============================================

DO $$
BEGIN
    RAISE NOTICE 'Миграция 173d успешно применена: дубликаты очищены, unique constraint добавлен';
    RAISE WARNING 'ВАЖНО: Проверьте консультантов с user_account_id = NULL и создайте для них новые user_accounts если необходимо';
END$$;
