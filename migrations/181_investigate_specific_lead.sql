-- =============================================
-- Расследование конкретного лида: +7 707 486 5437
-- Цель: понять почему не распределился и откуда уведомление
-- =============================================

-- 1. НАЙТИ ВСЕ ЗАПИСИ С ЭТИМ НОМЕРОМ
-- =============================================

SELECT
    da.id,
    da.contact_name,
    da.contact_phone,
    da.user_account_id,
    ua.username as company_account,
    ua.role as account_role,
    da.assigned_consultant_id,
    c.name as assigned_consultant_name,
    da.interest_level,
    da.funnel_stage,
    da.created_at,
    da.updated_at,

    -- Статус назначения
    CASE
        WHEN da.assigned_consultant_id IS NOT NULL THEN '✅ НАЗНАЧЕН'
        WHEN da.user_account_id IS NULL THEN '❌ user_account_id = NULL'
        ELSE '❌ НЕ НАЗНАЧЕН'
    END as status

FROM dialog_analysis da
LEFT JOIN user_accounts ua ON ua.id = da.user_account_id
LEFT JOIN consultants c ON c.id = da.assigned_consultant_id
WHERE da.contact_phone LIKE '%707%486%5437%'
   OR da.contact_phone LIKE '%7074865437%'
ORDER BY da.created_at DESC;

-- 2. ПРОВЕРИТЬ КОНСУЛЬТАНТОВ ДЛЯ ЭТОГО USER_ACCOUNT_ID
-- =============================================

WITH lead_account AS (
    SELECT DISTINCT user_account_id
    FROM dialog_analysis
    WHERE contact_phone LIKE '%707%486%5437%'
       OR contact_phone LIKE '%7074865437%'
    LIMIT 1
)
SELECT
    c.id,
    c.name,
    c.parent_user_account_id,
    ua.username as company_account,
    c.is_active,
    c.accepts_new_leads,
    c.created_at,

    -- Сколько лидов у консультанта
    (SELECT COUNT(*) FROM dialog_analysis WHERE assigned_consultant_id = c.id) as total_leads,

    -- Статус
    CASE
        WHEN c.is_active AND c.accepts_new_leads THEN '✅ Доступен для распределения'
        WHEN c.is_active AND NOT c.accepts_new_leads THEN '⚠️ Активен, но НЕ принимает лиды'
        WHEN NOT c.is_active THEN '❌ Неактивен'
    END as status

FROM consultants c
LEFT JOIN user_accounts ua ON ua.id = c.parent_user_account_id
WHERE c.parent_user_account_id = (SELECT user_account_id FROM lead_account)
ORDER BY c.is_active DESC, c.accepts_new_leads DESC, c.created_at ASC;

-- 3. ПРОВЕРИТЬ КОНСУЛЬТАЦИИ С ЭТИМ НОМЕРОМ
-- =============================================

SELECT
    cons.id,
    cons.client_name,
    cons.client_phone,
    cons.consultant_id,
    c.name as consultant_name,
    cons.date,
    cons.start_time,
    cons.end_time,
    cons.status,
    cons.consultation_type,
    cons.price,
    cons.notes,
    cons.created_at,
    cons.updated_at

FROM consultations cons
LEFT JOIN consultants c ON c.id = cons.consultant_id
WHERE cons.client_phone LIKE '%707%486%5437%'
   OR cons.client_phone LIKE '%7074865437%'
ORDER BY cons.created_at DESC;

-- 4. ПРОВЕРИТЬ ИСТОРИЮ ИЗМЕНЕНИЙ (если есть audit log)
-- =============================================

-- Проверяем есть ли таблица аудита
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'audit_log'
    ) THEN
        RAISE NOTICE 'Таблица audit_log существует - проверьте логи вручную';
    ELSE
        RAISE NOTICE 'Таблица audit_log не найдена';
    END IF;
END$$;

-- 5. ПОПРОБОВАТЬ НАЗНАЧИТЬ ВРУЧНУЮ (для теста)
-- =============================================

DO $$
DECLARE
    v_user_account_id UUID;
    v_consultant_id UUID;
    v_lead_id UUID;
BEGIN
    -- Находим user_account_id лида
    SELECT user_account_id, id INTO v_user_account_id, v_lead_id
    FROM dialog_analysis
    WHERE contact_phone LIKE '%707%486%5437%'
       OR contact_phone LIKE '%7074865437%'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_user_account_id IS NULL THEN
        RAISE WARNING '⚠️ ПРОБЛЕМА: У лида user_account_id = NULL!';
        RAISE WARNING 'Лид не может быть распределён без user_account_id';
        RAISE WARNING 'Проверьте откуда приходит этот лид и почему не установлен user_account_id';
        RETURN;
    END IF;

    RAISE NOTICE 'User account ID лида: %', v_user_account_id;

    -- Пробуем найти консультанта
    v_consultant_id := assign_lead_to_consultant(v_user_account_id);

    IF v_consultant_id IS NULL THEN
        RAISE WARNING '❌ Функция assign_lead_to_consultant вернула NULL';
        RAISE WARNING 'Причины:';
        RAISE WARNING '  1. Нет консультантов для user_account_id = %', v_user_account_id;
        RAISE WARNING '  2. Все консультанты is_active = false';
        RAISE WARNING '  3. Все консультанты accepts_new_leads = false';

        -- Проверяем консультантов
        PERFORM 1 FROM consultants
        WHERE parent_user_account_id = v_user_account_id;

        IF NOT FOUND THEN
            RAISE WARNING '  ⛔ Подтверждено: Нет консультантов для этого аккаунта';
        ELSE
            RAISE WARNING '  Консультанты есть, но не подходят под критерии (is_active=true AND accepts_new_leads=true)';
        END IF;
    ELSE
        RAISE NOTICE '✅ Функция вернула консультанта: %', v_consultant_id;

        -- Показываем информацию о консультанте
        RAISE NOTICE 'Информация о консультанте:';
        PERFORM c.name, c.is_active, c.accepts_new_leads
        FROM consultants c
        WHERE c.id = v_consultant_id;

        RAISE NOTICE 'Если лид не назначен автоматически, но функция возвращает консультанта - проблема в триггере!';
    END IF;
END$$;

-- 6. ИТОГОВЫЙ ОТЧЁТ
-- =============================================
DO $$
DECLARE
    v_lead_id UUID;
    v_contact_name TEXT;
    v_user_account_id UUID;
    v_assigned_consultant_id UUID;
    v_created_at TIMESTAMPTZ;
    v_has_consultants BOOLEAN;
    v_has_active_consultants BOOLEAN;
    v_has_accepting_consultants BOOLEAN;
BEGIN
    -- Находим лид
    SELECT id, contact_name, user_account_id, assigned_consultant_id, created_at
    INTO v_lead_id, v_contact_name, v_user_account_id, v_assigned_consultant_id, v_created_at
    FROM dialog_analysis
    WHERE contact_phone LIKE '%707%486%5437%'
       OR contact_phone LIKE '%7074865437%'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_lead_id IS NULL THEN
        RAISE WARNING '❌ Лид с номером +7 707 486 5437 не найден в базе!';
        RETURN;
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE '📋 ОТЧЁТ ПО ЛИДУ: %', v_contact_name;
    RAISE NOTICE '========================================';
    RAISE NOTICE 'ID: %', v_lead_id;
    RAISE NOTICE 'Создан: %', v_created_at;
    RAISE NOTICE 'User Account ID: %', COALESCE(v_user_account_id::text, 'NULL ❌');
    RAISE NOTICE 'Assigned Consultant ID: %', COALESCE(v_assigned_consultant_id::text, 'NULL (НЕ НАЗНАЧЕН) ❌');
    RAISE NOTICE '';

    -- Диагностика
    IF v_user_account_id IS NULL THEN
        RAISE WARNING '🔴 ПРИЧИНА: user_account_id = NULL';
        RAISE WARNING 'Лид не привязан к аккаунту компании!';
        RAISE WARNING 'Проверьте:';
        RAISE WARNING '  - Откуда приходит этот лид (chatbot, форма, API)?';
        RAISE WARNING '  - Почему не установлен user_account_id при создании?';
        RAISE WARNING '  - Код создания лида в backend';
    ELSE
        -- Проверяем консультантов
        SELECT EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = v_user_account_id
        ) INTO v_has_consultants;

        SELECT EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = v_user_account_id
            AND is_active = true
        ) INTO v_has_active_consultants;

        SELECT EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = v_user_account_id
            AND is_active = true
            AND accepts_new_leads = true
        ) INTO v_has_accepting_consultants;

        IF NOT v_has_consultants THEN
            RAISE WARNING '🔴 ПРИЧИНА: Нет консультантов для user_account_id = %', v_user_account_id;
            RAISE WARNING 'Создайте консультанта для этого аккаунта!';
        ELSIF NOT v_has_active_consultants THEN
            RAISE WARNING '🔴 ПРИЧИНА: Все консультанты неактивны (is_active = false)';
            RAISE WARNING 'Активируйте консультанта: UPDATE consultants SET is_active = true WHERE parent_user_account_id = %', v_user_account_id;
        ELSIF NOT v_has_accepting_consultants THEN
            RAISE WARNING '🔴 ПРИЧИНА: Консультанты не принимают новых лидов (accepts_new_leads = false)';
            RAISE WARNING 'Включите приём лидов: UPDATE consultants SET accepts_new_leads = true WHERE parent_user_account_id = %', v_user_account_id;
        ELSE
            RAISE WARNING '❓ ПРИЧИНА НЕИЗВЕСТНА: Консультанты доступны, но лид не назначен!';
            RAISE WARNING 'Возможные причины:';
            RAISE WARNING '  1. Триггер не сработал (проверьте trigger_auto_assign_lead)';
            RAISE WARNING '  2. Лид создан до внедрения триггера';
            RAISE WARNING '  3. Лид создан напрямую в БД минуя INSERT (например UPDATE существующей записи)';
        END IF;
    END IF;

    RAISE NOTICE '========================================';
END$$;
