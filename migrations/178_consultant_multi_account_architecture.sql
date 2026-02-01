-- =============================================
-- Миграция 178: Архитектура консультантов по паттерну мультиаккаунта
-- Описание: Разделение логинов консультантов и привязки к компании.
--           Аналогично ad_accounts: user_account → consultants → consultant_accounts
-- Дата: 2026-02-01
-- =============================================

-- 1. СОЗДАНИЕ ТАБЛИЦЫ ЛОГИНОВ КОНСУЛЬТАНТОВ
-- =============================================

CREATE TABLE IF NOT EXISTS consultant_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,

  -- Credentials для входа на /c/:consultantId
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,

  -- Роль (всегда 'consultant')
  role user_role DEFAULT 'consultant',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Unique constraint: один логин на консультанта
  CONSTRAINT unique_consultant_account UNIQUE (consultant_id)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_consultant_accounts_consultant_id
ON consultant_accounts(consultant_id);

CREATE INDEX IF NOT EXISTS idx_consultant_accounts_username
ON consultant_accounts(username);

-- Комментарии
COMMENT ON TABLE consultant_accounts IS 'Логины консультантов для входа на /c/:consultantId. Отдельная аутентификация от user_accounts.';
COMMENT ON COLUMN consultant_accounts.consultant_id IS 'Связь с консультантом (один к одному)';
COMMENT ON COLUMN consultant_accounts.username IS 'Логин для входа (уникальный глобально)';
COMMENT ON COLUMN consultant_accounts.password IS 'Пароль (TODO: хеширование в будущем)';

-- Триггер автообновления updated_at
CREATE OR REPLACE FUNCTION update_consultant_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_consultant_accounts_updated_at ON consultant_accounts;
CREATE TRIGGER trigger_consultant_accounts_updated_at
BEFORE UPDATE ON consultant_accounts
FOR EACH ROW
EXECUTE FUNCTION update_consultant_accounts_updated_at();

-- 2. УДАЛЕНИЕ UNIQUE CONSTRAINT НА consultants.user_account_id
-- =============================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_consultant_user_account'
    ) THEN
        ALTER TABLE consultants
        DROP CONSTRAINT unique_consultant_user_account;
        RAISE NOTICE 'Удалён UNIQUE constraint на user_account_id (один аккаунт может иметь много консультантов)';
    ELSE
        RAISE NOTICE 'UNIQUE constraint уже отсутствует';
    END IF;
END$$;

-- 3. ПЕРЕИМЕНОВАНИЕ user_account_id → parent_user_account_id
-- =============================================

DO $$
BEGIN
    -- Проверяем, существует ли уже parent_user_account_id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consultants' AND column_name = 'parent_user_account_id'
    ) THEN
        -- Переименовываем user_account_id → parent_user_account_id
        ALTER TABLE consultants
        RENAME COLUMN user_account_id TO parent_user_account_id;

        RAISE NOTICE 'Переименовано: user_account_id → parent_user_account_id';
    ELSE
        RAISE NOTICE 'Поле parent_user_account_id уже существует';
    END IF;
END$$;

-- Обновляем комментарий
COMMENT ON COLUMN consultants.parent_user_account_id IS 'ID аккаунта компании (владельца). Много консультантов могут принадлежать одному user_account.';

-- 4. МИГРАЦИЯ СУЩЕСТВУЮЩИХ ДАННЫХ
-- =============================================

DO $$
DECLARE
    migrated_count INTEGER := 0;
    consultant_rec RECORD;
    admin_account_id UUID;
BEGIN
    -- Находим первый admin аккаунт (или tech_admin)
    SELECT id INTO admin_account_id
    FROM user_accounts
    WHERE role = 'admin' OR is_tech_admin = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF admin_account_id IS NULL THEN
        RAISE WARNING 'Не найден admin аккаунт для миграции! Консультанты останутся с parent_user_account_id = NULL';
        RETURN;
    END IF;

    RAISE NOTICE 'Используем admin аккаунт: %', admin_account_id;

    -- Мигрируем каждого консультанта
    FOR consultant_rec IN (
        SELECT
            c.id as consultant_id,
            c.parent_user_account_id as current_parent_id,
            ua.id as login_account_id,
            ua.username,
            ua.password,
            ua.role
        FROM consultants c
        LEFT JOIN user_accounts ua ON ua.id = c.parent_user_account_id
        WHERE c.parent_user_account_id IS NOT NULL
    ) LOOP
        -- Если parent_user_account_id указывает на consultant аккаунт
        IF consultant_rec.role = 'consultant' THEN
            -- Создаём запись в consultant_accounts
            INSERT INTO consultant_accounts (consultant_id, username, password, role)
            VALUES (
                consultant_rec.consultant_id,
                consultant_rec.username,
                consultant_rec.password,
                'consultant'
            )
            ON CONFLICT (consultant_id) DO NOTHING;

            -- Устанавливаем parent_user_account_id на admin аккаунт
            UPDATE consultants
            SET parent_user_account_id = admin_account_id
            WHERE id = consultant_rec.consultant_id;

            migrated_count := migrated_count + 1;
        END IF;
        -- Если parent_user_account_id уже указывает на admin - ничего не делаем
    END LOOP;

    RAISE NOTICE 'Мигрировано % консультантов: создана запись в consultant_accounts, parent_user_account_id установлен на admin', migrated_count;
END$$;

-- 5. ОБНОВЛЕНИЕ ИНДЕКСОВ
-- =============================================

-- Удаляем старый индекс
DROP INDEX IF EXISTS idx_consultants_user_account;

-- Создаём новый индекс для parent_user_account_id
CREATE INDEX IF NOT EXISTS idx_consultants_parent_user_account
ON consultants(parent_user_account_id)
WHERE parent_user_account_id IS NOT NULL;

-- Композитный индекс для быстрой фильтрации активных консультантов компании
CREATE INDEX IF NOT EXISTS idx_consultants_parent_active
ON consultants(parent_user_account_id, is_active)
WHERE parent_user_account_id IS NOT NULL;

-- 6. ОБНОВЛЕНИЕ ФУНКЦИЙ И VIEW (если используются)
-- =============================================

-- Обновляем функцию round-robin распределения лидов (если использует user_account_id)
DO $$
BEGIN
    -- Проверяем существование функции
    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'assign_lead_to_consultant'
    ) THEN
        -- Пересоздаём функцию с правильным полем
        CREATE OR REPLACE FUNCTION assign_lead_to_consultant(p_user_account_id UUID)
        RETURNS UUID
        LANGUAGE plpgsql
        AS $func$
        DECLARE
            selected_consultant_id UUID;
        BEGIN
            -- Выбираем консультанта с минимальным количеством лидов
            SELECT c.id INTO selected_consultant_id
            FROM consultants c
            LEFT JOIN dialog_analysis da ON da.assigned_consultant_id = c.id
            WHERE c.is_active = true
              AND c.accepts_new_leads = true
              AND c.parent_user_account_id = p_user_account_id
            GROUP BY c.id
            ORDER BY COUNT(da.id) ASC, c.created_at ASC
            LIMIT 1;

            RETURN selected_consultant_id;
        END;
        $func$;

        RAISE NOTICE 'Функция assign_lead_to_consultant обновлена для использования parent_user_account_id';
    END IF;
END$$;

-- Обновляем view dashboard (если использует user_account_id)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_views WHERE viewname = 'consultant_dashboard_stats'
    ) THEN
        DROP VIEW IF EXISTS consultant_dashboard_stats CASCADE;

        CREATE VIEW consultant_dashboard_stats AS
        SELECT
            c.id as consultant_id,
            c.parent_user_account_id as user_account_id,
            c.name,
            c.is_active,
            c.accepts_new_leads,

            -- Статистика лидов
            COUNT(DISTINCT da.id) as total_leads,
            COUNT(DISTINCT da.id) FILTER (WHERE da.interest_level = 'hot') as hot_leads,
            COUNT(DISTINCT da.id) FILTER (WHERE da.interest_level = 'warm') as warm_leads,
            COUNT(DISTINCT da.id) FILTER (WHERE da.interest_level = 'cold') as cold_leads,

            -- Статистика консультаций
            COUNT(DISTINCT cons.id) FILTER (
                WHERE cons.status IN ('scheduled', 'confirmed')
            ) as booked_leads,
            COUNT(DISTINCT cons.id) as total_consultations,
            COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'scheduled') as scheduled,
            COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'confirmed') as confirmed,
            COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'completed') as completed,
            COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'cancelled') as cancelled,
            COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'no_show') as no_show,

            -- Общий доход
            COALESCE(SUM(cons.price) FILTER (WHERE cons.status = 'completed'), 0) as total_revenue,

            -- Процент завершённых консультаций
            CASE
                WHEN COUNT(DISTINCT cons.id) > 0
                THEN ROUND(
                    100.0 * COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'completed')
                    / COUNT(DISTINCT cons.id),
                    1
                )
                ELSE 0
            END as completion_rate

        FROM consultants c
        LEFT JOIN dialog_analysis da ON da.assigned_consultant_id = c.id
        LEFT JOIN consultations cons ON cons.consultant_id = c.id
        WHERE c.is_active = true
        GROUP BY c.id, c.parent_user_account_id, c.name, c.is_active, c.accepts_new_leads;

        COMMENT ON VIEW consultant_dashboard_stats IS 'Статистика консультанта для dashboard (обновлена для parent_user_account_id)';

        RAISE NOTICE 'View consultant_dashboard_stats обновлена';
    END IF;
END$$;

-- =============================================
-- ЗАВЕРШЕНИЕ МИГРАЦИИ 178
-- =============================================

DO $$
DECLARE
    consultant_count INTEGER;
    consultant_account_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO consultant_count FROM consultants;
    SELECT COUNT(*) INTO consultant_account_count FROM consultant_accounts;

    RAISE NOTICE '============================================';
    RAISE NOTICE 'Миграция 178 успешно применена';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'Изменения:';
    RAISE NOTICE '1. Создана таблица consultant_accounts';
    RAISE NOTICE '2. Удалён UNIQUE constraint на user_account_id';
    RAISE NOTICE '3. Переименовано: user_account_id → parent_user_account_id';
    RAISE NOTICE '4. Мигрированы существующие данные';
    RAISE NOTICE '5. Обновлены индексы';
    RAISE NOTICE '6. Обновлены функции и view';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'Статистика:';
    RAISE NOTICE '- Консультантов: %', consultant_count;
    RAISE NOTICE '- Логинов консультантов: %', consultant_account_count;
    RAISE NOTICE '============================================';
    RAISE WARNING 'ВАЖНО: Обновите backend код (consultantsManagement.ts, consultantAuth.ts)';
    RAISE WARNING 'для работы с новой таблицей consultant_accounts!';
    RAISE NOTICE '============================================';
END$$;
