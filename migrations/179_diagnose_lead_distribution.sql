-- =============================================
-- Диагностика распределения лидов
-- Проверяем почему некоторые лиды не распределяются
-- =============================================

-- 1. ОБЩАЯ СТАТИСТИКА ЛИДОВ
-- =============================================
SELECT
    'Общая статистика' as category,
    COUNT(*) as total_leads,
    COUNT(assigned_consultant_id) as assigned_leads,
    COUNT(*) - COUNT(assigned_consultant_id) as unassigned_leads
FROM dialog_analysis;

-- 2. ЛИДЫ БЕЗ assigned_consultant_id С ПРИЧИНАМИ
-- =============================================
SELECT
    'Неназначенные лиды' as category,
    da.id,
    da.contact_name,
    da.contact_phone,
    da.user_account_id,
    da.created_at,
    CASE
        WHEN da.user_account_id IS NULL THEN 'user_account_id = NULL'
        WHEN NOT EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = da.user_account_id
            AND is_active = true
            AND accepts_new_leads = true
        ) THEN 'Нет доступных консультантов для этого user_account_id'
        ELSE 'Неизвестная причина'
    END as reason
FROM dialog_analysis da
WHERE da.assigned_consultant_id IS NULL
ORDER BY da.created_at DESC;

-- 3. СТАТИСТИКА ПО user_account_id
-- =============================================
SELECT
    'Распределение по аккаунтам' as category,
    da.user_account_id,
    ua.username as account_name,
    COUNT(*) as total_leads,
    COUNT(da.assigned_consultant_id) as assigned,
    COUNT(*) - COUNT(da.assigned_consultant_id) as unassigned
FROM dialog_analysis da
LEFT JOIN user_accounts ua ON ua.id = da.user_account_id
GROUP BY da.user_account_id, ua.username
ORDER BY unassigned DESC;

-- 4. КОНСУЛЬТАНТЫ И ИХ НАСТРОЙКИ
-- =============================================
SELECT
    'Консультанты' as category,
    c.id,
    c.name,
    c.parent_user_account_id,
    ua.username as account_name,
    c.is_active,
    c.accepts_new_leads,
    COUNT(da.id) as assigned_leads_count
FROM consultants c
LEFT JOIN user_accounts ua ON ua.id = c.parent_user_account_id
LEFT JOIN dialog_analysis da ON da.assigned_consultant_id = c.id
GROUP BY c.id, c.name, c.parent_user_account_id, ua.username, c.is_active, c.accepts_new_leads
ORDER BY c.parent_user_account_id, c.name;

-- 5. ПОСЛЕДНИЕ 20 ЛИДОВ (для проверки триггера)
-- =============================================
SELECT
    'Последние лиды' as category,
    da.id,
    da.contact_name,
    da.contact_phone,
    da.user_account_id,
    da.assigned_consultant_id,
    c.name as consultant_name,
    da.created_at,
    CASE
        WHEN da.assigned_consultant_id IS NOT NULL THEN '✅ Назначен'
        WHEN da.user_account_id IS NULL THEN '❌ user_account_id = NULL'
        ELSE '❌ Не назначен'
    END as status
FROM dialog_analysis da
LEFT JOIN consultants c ON c.id = da.assigned_consultant_id
ORDER BY da.created_at DESC
LIMIT 20;

-- 6. ПРОВЕРКА ТРИГГЕРА
-- =============================================
SELECT
    'Триггеры' as category,
    tgname as trigger_name,
    tgrelid::regclass as table_name,
    tgenabled as enabled
FROM pg_trigger
WHERE tgname LIKE '%assign%';

-- =============================================
-- ИТОГОВЫЙ ОТЧЁТ
-- =============================================
DO $$
DECLARE
    v_total INTEGER;
    v_assigned INTEGER;
    v_unassigned INTEGER;
    v_no_user_account INTEGER;
    v_no_consultants INTEGER;
BEGIN
    -- Считаем статистику
    SELECT COUNT(*) INTO v_total FROM dialog_analysis;
    SELECT COUNT(*) INTO v_assigned FROM dialog_analysis WHERE assigned_consultant_id IS NOT NULL;
    v_unassigned := v_total - v_assigned;

    SELECT COUNT(*) INTO v_no_user_account
    FROM dialog_analysis
    WHERE assigned_consultant_id IS NULL AND user_account_id IS NULL;

    SELECT COUNT(*) INTO v_no_consultants
    FROM dialog_analysis da
    WHERE da.assigned_consultant_id IS NULL
    AND da.user_account_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM consultants
        WHERE parent_user_account_id = da.user_account_id
        AND is_active = true
        AND accepts_new_leads = true
    );

    RAISE NOTICE '========================================';
    RAISE NOTICE 'ИТОГОВЫЙ ОТЧЁТ';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Всего лидов: %', v_total;
    RAISE NOTICE 'Назначено: % (%.1f%%)', v_assigned, (v_assigned::float / v_total * 100);
    RAISE NOTICE 'Не назначено: % (%.1f%%)', v_unassigned, (v_unassigned::float / v_total * 100);
    RAISE NOTICE '';
    RAISE NOTICE 'Причины НЕ назначения:';
    RAISE NOTICE '  - user_account_id = NULL: %', v_no_user_account;
    RAISE NOTICE '  - Нет доступных консультантов: %', v_no_consultants;
    RAISE NOTICE '  - Другие причины: %', v_unassigned - v_no_user_account - v_no_consultants;
    RAISE NOTICE '========================================';
END$$;
