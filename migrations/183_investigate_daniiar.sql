-- =============================================
-- Расследование проблемы с именем "Данияр"
-- Цель: найти откуда берётся имя "Данияр" в уведомлениях
-- =============================================

-- 1. НАЙТИ ВСЕХ "ДАНИЯР" В DIALOG_ANALYSIS
-- =============================================

SELECT
    'Лиды с именем Данияр' as report_name;

SELECT
    da.id,
    da.contact_name,
    da.contact_phone,
    da.user_account_id,
    ua.username as company_account,
    da.assigned_consultant_id,
    c.name as assigned_consultant_name,
    da.created_at,
    da.updated_at,
    da.last_message
FROM dialog_analysis da
LEFT JOIN user_accounts ua ON ua.id = da.user_account_id
LEFT JOIN consultants c ON c.id = da.assigned_consultant_id
WHERE da.contact_name ILIKE '%Данияр%'
   OR da.contact_name ILIKE '%Daniiar%'
   OR da.contact_name ILIKE '%Daniyar%'
ORDER BY da.updated_at DESC;

-- 2. НАЙТИ КОНСУЛЬТАЦИИ С ИМЕНЕМ "ДАНИЯР"
-- =============================================

SELECT
    'Консультации с именем Данияр' as report_name;

SELECT
    cons.id,
    cons.client_name,
    cons.client_phone,
    cons.consultant_id,
    c.name as consultant_name,
    cons.date,
    cons.start_time,
    cons.status,
    cons.dialog_analysis_id,
    cons.created_at
FROM consultations cons
LEFT JOIN consultants c ON c.id = cons.consultant_id
WHERE cons.client_name ILIKE '%Данияр%'
   OR cons.client_name ILIKE '%Daniiar%'
   OR cons.client_name ILIKE '%Daniyar%'
ORDER BY cons.created_at DESC;

-- 3. НАЙТИ КОНСУЛЬТАНТОВ С ИМЕНЕМ "ДАНИЯР"
-- =============================================

SELECT
    'Консультанты с именем Данияр' as report_name;

SELECT
    c.id,
    c.name,
    c.phone,
    c.parent_user_account_id,
    ua.username as company_account,
    c.is_active,
    c.accepts_new_leads,
    c.created_at
FROM consultants c
LEFT JOIN user_accounts ua ON ua.id = c.parent_user_account_id
WHERE c.name ILIKE '%Данияр%'
   OR c.name ILIKE '%Daniiar%'
   OR c.name ILIKE '%Daniyar%';

-- 4. ПРОВЕРИТЬ НЕСООТВЕТСТВИЯ: консультация с одним именем, а dialog_analysis с другим
-- =============================================

SELECT
    'Несоответствия имён (консультация vs dialog_analysis)' as report_name;

SELECT
    cons.id as consultation_id,
    cons.client_name as name_in_consultation,
    cons.client_phone as phone_in_consultation,
    da.contact_name as name_in_dialog_analysis,
    da.contact_phone as phone_in_dialog_analysis,
    cons.consultant_id,
    c.name as consultant_name,
    cons.date,
    cons.start_time,
    cons.status,
    cons.created_at
FROM consultations cons
LEFT JOIN dialog_analysis da ON da.id = cons.dialog_analysis_id
LEFT JOIN consultants c ON c.id = cons.consultant_id
WHERE cons.dialog_analysis_id IS NOT NULL
  AND (
    -- Имена не совпадают
    cons.client_name IS DISTINCT FROM da.contact_name
    OR
    -- Телефоны не совпадают
    cons.client_phone != da.contact_phone
  )
ORDER BY cons.created_at DESC
LIMIT 50;

-- 5. ПРОВЕРИТЬ ПОСЛЕДНИЕ УВЕДОМЛЕНИЯ
-- =============================================

SELECT
    'Последние scheduled уведомления' as report_name;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'scheduled_notifications'
    ) THEN
        -- Если таблица существует, показываем последние записи
        EXECUTE '
        SELECT
            sn.id,
            sn.consultation_id,
            sn.notification_type,
            sn.scheduled_at,
            sn.status,
            sn.created_at,
            cons.client_name,
            cons.client_phone
        FROM scheduled_notifications sn
        LEFT JOIN consultations cons ON cons.id = sn.consultation_id
        ORDER BY sn.created_at DESC
        LIMIT 20';
    ELSE
        RAISE NOTICE 'Таблица scheduled_notifications не найдена';
    END IF;
END$$;

-- 6. ИТОГОВЫЙ ОТЧЁТ
-- =============================================

DO $$
DECLARE
    v_daniiar_leads INTEGER;
    v_daniiar_consultations INTEGER;
    v_daniiar_consultants INTEGER;
    v_mismatched_names INTEGER;
BEGIN
    -- Считаем статистику
    SELECT COUNT(*) INTO v_daniiar_leads
    FROM dialog_analysis
    WHERE contact_name ILIKE '%Данияр%'
       OR contact_name ILIKE '%Daniiar%'
       OR contact_name ILIKE '%Daniyar%';

    SELECT COUNT(*) INTO v_daniiar_consultations
    FROM consultations
    WHERE client_name ILIKE '%Данияр%'
       OR client_name ILIKE '%Daniiar%'
       OR client_name ILIKE '%Daniyar%';

    SELECT COUNT(*) INTO v_daniiar_consultants
    FROM consultants
    WHERE name ILIKE '%Данияр%'
       OR name ILIKE '%Daniiar%'
       OR name ILIKE '%Daniyar%';

    SELECT COUNT(*) INTO v_mismatched_names
    FROM consultations cons
    LEFT JOIN dialog_analysis da ON da.id = cons.dialog_analysis_id
    WHERE cons.dialog_analysis_id IS NOT NULL
      AND cons.client_name IS DISTINCT FROM da.contact_name;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'ОТЧЁТ: Расследование "Данияр"';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Найдено записей с именем "Данияр":';
    RAISE NOTICE '  - В dialog_analysis (лиды): %', v_daniiar_leads;
    RAISE NOTICE '  - В consultations: %', v_daniiar_consultations;
    RAISE NOTICE '  - В consultants (консультанты): %', v_daniiar_consultants;
    RAISE NOTICE '';
    RAISE NOTICE 'Несоответствия:';
    RAISE NOTICE '  - Консультаций где имя не совпадает с dialog_analysis: %', v_mismatched_names;
    RAISE NOTICE '';

    IF v_daniiar_consultants > 0 THEN
        RAISE WARNING '⚠️ Найден КОНСУЛЬТАНТ с именем "Данияр"!';
        RAISE WARNING 'Возможно, в шаблоне уведомлений используется {{consultant_name}} вместо {{client_name}}';
    END IF;

    IF v_mismatched_names > 0 THEN
        RAISE WARNING '⚠️ Найдены несоответствия имён между consultations и dialog_analysis!';
        RAISE WARNING 'При создании консультации могли взять не тот dialog_analysis_id';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE 'Проверьте результаты запросов выше для детальной информации';
    RAISE NOTICE '========================================';
END$$;
