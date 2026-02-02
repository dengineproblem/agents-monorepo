-- =============================================
-- Диагностика свежих лидов (последние 24 часа)
-- Цель: понять почему некоторые лиды не распределяются
-- =============================================

-- 1. СТАТИСТИКА ЗА ПОСЛЕДНИЕ 24 ЧАСА
-- =============================================
DO $$
DECLARE
    v_total_recent INTEGER;
    v_assigned_recent INTEGER;
    v_unassigned_recent INTEGER;
BEGIN
    -- Считаем лиды за последние 24 часа
    SELECT COUNT(*) INTO v_total_recent
    FROM dialog_analysis
    WHERE created_at >= NOW() - INTERVAL '24 hours';

    SELECT COUNT(*) INTO v_assigned_recent
    FROM dialog_analysis
    WHERE created_at >= NOW() - INTERVAL '24 hours'
    AND assigned_consultant_id IS NOT NULL;

    v_unassigned_recent := v_total_recent - v_assigned_recent;

    RAISE NOTICE '========================================'  ;
    RAISE NOTICE 'СТАТИСТИКА ЗА ПОСЛЕДНИЕ 24 ЧАСА';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Всего лидов: %', v_total_recent;
    RAISE NOTICE 'Назначено: %', v_assigned_recent;
    RAISE NOTICE 'НЕ назначено: %', v_unassigned_recent;
    RAISE NOTICE '========================================';
END$$;

-- 2. ПОДРОБНЫЙ АНАЛИЗ ПОСЛЕДНИХ ЛИДОВ
-- =============================================
SELECT
    'Последние 30 лидов с детализацией' as report_name;

SELECT
    da.id,
    da.contact_name,
    da.contact_phone,
    da.user_account_id,
    ua.username as company_account,
    da.assigned_consultant_id,
    c.name as assigned_consultant_name,
    da.created_at,

    -- Статус назначения
    CASE
        WHEN da.assigned_consultant_id IS NOT NULL THEN '✅ НАЗНАЧЕН'
        WHEN da.user_account_id IS NULL THEN '❌ user_account_id = NULL'
        WHEN NOT EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = da.user_account_id
        ) THEN '❌ Нет консультантов для этого аккаунта'
        WHEN NOT EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = da.user_account_id
            AND is_active = true
        ) THEN '❌ Консультанты неактивны (is_active = false)'
        WHEN NOT EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = da.user_account_id
            AND is_active = true
            AND accepts_new_leads = true
        ) THEN '❌ Консультанты не принимают лиды (accepts_new_leads = false)'
        ELSE '❓ НЕИЗВЕСТНАЯ ПРИЧИНА'
    END as assignment_status,

    -- Количество доступных консультантов
    (
        SELECT COUNT(*)
        FROM consultants
        WHERE parent_user_account_id = da.user_account_id
        AND is_active = true
        AND accepts_new_leads = true
    ) as available_consultants_count

FROM dialog_analysis da
LEFT JOIN user_accounts ua ON ua.id = da.user_account_id
LEFT JOIN consultants c ON c.id = da.assigned_consultant_id
ORDER BY da.created_at DESC
LIMIT 30;

-- 3. СТАТИСТИКА КОНСУЛЬТАНТОВ ПО КАЖДОМУ АККАУНТУ
-- =============================================
SELECT
    'Консультанты по аккаунтам' as report_name;

WITH account_stats AS (
    SELECT
        ua.id as user_account_id,
        ua.username as company_name,
        COUNT(DISTINCT c.id) FILTER (WHERE c.is_active = true AND c.accepts_new_leads = true) as active_accepting_consultants,
        COUNT(DISTINCT c.id) FILTER (WHERE c.is_active = true AND c.accepts_new_leads = false) as active_not_accepting,
        COUNT(DISTINCT c.id) FILTER (WHERE c.is_active = false) as inactive_consultants,
        COUNT(DISTINCT da.id) FILTER (WHERE da.created_at >= NOW() - INTERVAL '24 hours') as recent_leads,
        COUNT(DISTINCT da.id) FILTER (
            WHERE da.created_at >= NOW() - INTERVAL '24 hours'
            AND da.assigned_consultant_id IS NOT NULL
        ) as recent_assigned
    FROM user_accounts ua
    LEFT JOIN consultants c ON c.parent_user_account_id = ua.id
    LEFT JOIN dialog_analysis da ON da.user_account_id = ua.id
    WHERE ua.role IN ('admin', 'user')
    GROUP BY ua.id, ua.username
    HAVING COUNT(DISTINCT da.id) FILTER (WHERE da.created_at >= NOW() - INTERVAL '24 hours') > 0
)
SELECT
    user_account_id,
    company_name,
    active_accepting_consultants as "✅ Активные консультанты (принимают лиды)",
    active_not_accepting as "⚠️ Активные (НЕ принимают)",
    inactive_consultants as "❌ Неактивные",
    recent_leads as "Лиды за 24ч",
    recent_assigned as "Назначено за 24ч",
    recent_leads - recent_assigned as "НЕ назначено за 24ч",
    CASE
        WHEN active_accepting_consultants = 0 THEN '⛔ НЕТ ДОСТУПНЫХ КОНСУЛЬТАНТОВ'
        WHEN recent_leads = recent_assigned THEN '✅ ВСЕ РАСПРЕДЕЛЕНЫ'
        ELSE '⚠️ ЕСТЬ НЕРАСПРЕДЕЛЁННЫЕ'
    END as status
FROM account_stats
ORDER BY recent_leads DESC;

-- 4. ДЕТАЛИ ПО НЕРАСПРЕДЕЛЁННЫМ ЛИДАМ ЗА 24 ЧАСА
-- =============================================
SELECT
    'Нераспределённые лиды за 24 часа (детали)' as report_name;

SELECT
    da.id,
    da.contact_name,
    da.contact_phone,
    da.user_account_id,
    ua.username as company_account,
    da.created_at,

    -- Причина
    CASE
        WHEN da.user_account_id IS NULL THEN
            'user_account_id = NULL (лид не привязан к компании)'
        WHEN NOT EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = da.user_account_id
        ) THEN
            'Нет консультантов для этого аккаунта'
        WHEN NOT EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = da.user_account_id
            AND is_active = true
        ) THEN
            'Все консультанты неактивны (is_active = false)'
        WHEN NOT EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = da.user_account_id
            AND is_active = true
            AND accepts_new_leads = true
        ) THEN
            'Консультанты не принимают новых лидов (accepts_new_leads = false)'
        ELSE
            '❗ НЕИЗВЕСТНАЯ ПРИЧИНА - проверить триггер!'
    END as reason,

    -- Детали консультантов
    (
        SELECT json_agg(json_build_object(
            'id', c.id,
            'name', c.name,
            'is_active', c.is_active,
            'accepts_new_leads', c.accepts_new_leads,
            'leads_count', (
                SELECT COUNT(*) FROM dialog_analysis
                WHERE assigned_consultant_id = c.id
            )
        ))
        FROM consultants c
        WHERE c.parent_user_account_id = da.user_account_id
    ) as consultants_details

FROM dialog_analysis da
LEFT JOIN user_accounts ua ON ua.id = da.user_account_id
WHERE da.created_at >= NOW() - INTERVAL '24 hours'
AND da.assigned_consultant_id IS NULL
ORDER BY da.created_at DESC;

-- 5. ПРОВЕРКА ТРИГГЕРА
-- =============================================
SELECT
    'Проверка триггера auto_assign_lead' as report_name;

SELECT
    tgname as trigger_name,
    tgrelid::regclass as table_name,
    CASE tgenabled
        WHEN 'O' THEN '✅ Включён (O = ORIGIN - работает для обычных INSERT)'
        WHEN 'D' THEN '❌ Отключён'
        WHEN 'R' THEN '✅ Включён (R = REPLICA)'
        WHEN 'A' THEN '✅ Всегда включён'
        ELSE '❓ Неизвестный статус: ' || tgenabled
    END as status,
    tgtype as trigger_type
FROM pg_trigger
WHERE tgname = 'trigger_auto_assign_lead';

-- 6. ИТОГОВЫЙ ОТЧЁТ С РЕКОМЕНДАЦИЯМИ
-- =============================================
DO $$
DECLARE
    v_total_recent INTEGER;
    v_assigned_recent INTEGER;
    v_unassigned_recent INTEGER;
    v_null_account INTEGER;
    v_no_consultants INTEGER;
    v_inactive INTEGER;
    v_not_accepting INTEGER;
BEGIN
    -- Статистика за 24 часа
    SELECT COUNT(*) INTO v_total_recent
    FROM dialog_analysis
    WHERE created_at >= NOW() - INTERVAL '24 hours';

    SELECT COUNT(*) INTO v_assigned_recent
    FROM dialog_analysis
    WHERE created_at >= NOW() - INTERVAL '24 hours'
    AND assigned_consultant_id IS NOT NULL;

    v_unassigned_recent := v_total_recent - v_assigned_recent;

    -- Причины нераспределения
    SELECT COUNT(*) INTO v_null_account
    FROM dialog_analysis da
    WHERE da.created_at >= NOW() - INTERVAL '24 hours'
    AND da.assigned_consultant_id IS NULL
    AND da.user_account_id IS NULL;

    SELECT COUNT(*) INTO v_no_consultants
    FROM dialog_analysis da
    WHERE da.created_at >= NOW() - INTERVAL '24 hours'
    AND da.assigned_consultant_id IS NULL
    AND da.user_account_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM consultants
        WHERE parent_user_account_id = da.user_account_id
    );

    SELECT COUNT(*) INTO v_inactive
    FROM dialog_analysis da
    WHERE da.created_at >= NOW() - INTERVAL '24 hours'
    AND da.assigned_consultant_id IS NULL
    AND da.user_account_id IS NOT NULL
    AND EXISTS (
        SELECT 1 FROM consultants
        WHERE parent_user_account_id = da.user_account_id
    )
    AND NOT EXISTS (
        SELECT 1 FROM consultants
        WHERE parent_user_account_id = da.user_account_id
        AND is_active = true
    );

    SELECT COUNT(*) INTO v_not_accepting
    FROM dialog_analysis da
    WHERE da.created_at >= NOW() - INTERVAL '24 hours'
    AND da.assigned_consultant_id IS NULL
    AND da.user_account_id IS NOT NULL
    AND EXISTS (
        SELECT 1 FROM consultants
        WHERE parent_user_account_id = da.user_account_id
        AND is_active = true
    )
    AND NOT EXISTS (
        SELECT 1 FROM consultants
        WHERE parent_user_account_id = da.user_account_id
        AND is_active = true
        AND accepts_new_leads = true
    );

    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '📊 ИТОГОВЫЙ ОТЧЁТ ЗА ПОСЛЕДНИЕ 24 ЧАСА';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '📈 Общая статистика:';
    RAISE NOTICE '  Всего лидов: %', v_total_recent;
    RAISE NOTICE '  ✅ Назначено: % (%.1f%%)', v_assigned_recent,
        CASE WHEN v_total_recent > 0
        THEN (v_assigned_recent::float / v_total_recent * 100)
        ELSE 0 END;
    RAISE NOTICE '  ❌ НЕ назначено: % (%.1f%%)', v_unassigned_recent,
        CASE WHEN v_total_recent > 0
        THEN (v_unassigned_recent::float / v_total_recent * 100)
        ELSE 0 END;
    RAISE NOTICE '';
    RAISE NOTICE '🔍 Причины НЕ назначения:';
    RAISE NOTICE '  1️⃣ user_account_id = NULL: %', v_null_account;
    RAISE NOTICE '  2️⃣ Нет консультантов для аккаунта: %', v_no_consultants;
    RAISE NOTICE '  3️⃣ Консультанты неактивны: %', v_inactive;
    RAISE NOTICE '  4️⃣ Консультанты не принимают лиды: %', v_not_accepting;
    RAISE NOTICE '  ❓ Другие причины: %',
        v_unassigned_recent - v_null_account - v_no_consultants - v_inactive - v_not_accepting;
    RAISE NOTICE '';
    RAISE NOTICE '💡 РЕКОМЕНДАЦИИ:';

    IF v_null_account > 0 THEN
        RAISE NOTICE '  ⚠️ % лидов без user_account_id - проверить источник лидов', v_null_account;
    END IF;

    IF v_no_consultants > 0 THEN
        RAISE NOTICE '  ⚠️ % лидов для аккаунтов без консультантов - создать консультантов', v_no_consultants;
    END IF;

    IF v_inactive > 0 THEN
        RAISE NOTICE '  ⚠️ % лидов с неактивными консультантами - активировать консультантов (is_active = true)', v_inactive;
    END IF;

    IF v_not_accepting > 0 THEN
        RAISE NOTICE '  ⚠️ % лидов где консультанты не принимают - включить accepts_new_leads = true', v_not_accepting;
    END IF;

    IF v_unassigned_recent = 0 THEN
        RAISE NOTICE '  ✅ Все лиды успешно распределены!';
    END IF;

    RAISE NOTICE '========================================';
END$$;
