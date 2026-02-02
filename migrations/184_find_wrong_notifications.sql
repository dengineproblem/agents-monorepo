-- =============================================
-- Поиск неправильных уведомлений
-- Цель: найти консультации где client_name не совпадает с contact_name
-- =============================================

-- ОСНОВНОЙ ЗАПРОС: Найти несоответствия
SELECT
    cons.id as consultation_id,
    cons.created_at as consultation_created,

    -- Данные из consultations
    cons.client_name as "❌ Имя в консультации",
    cons.client_phone as "📞 Телефон в консультации",

    -- Данные из dialog_analysis
    da.contact_name as "✅ Реальное имя клиента",
    da.contact_phone as "📞 Реальный телефон",

    -- Консультант
    c.name as "👤 Консультант",

    -- Детали
    cons.date,
    cons.start_time,
    cons.status,
    cons.dialog_analysis_id,

    -- Тип несоответствия
    CASE
        WHEN cons.client_name != da.contact_name THEN '⚠️ ИМЕНА НЕ СОВПАДАЮТ'
        WHEN cons.client_phone != da.contact_phone THEN '⚠️ ТЕЛЕФОНЫ НЕ СОВПАДАЮТ'
        ELSE '✅ ОК'
    END as problem_type

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
LIMIT 100;

-- =============================================
-- ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: Консультации с "Данияр"
-- =============================================

SELECT
    '--- Консультации где в уведомлении было имя "Данияр" ---' as separator;

SELECT
    cons.id,
    cons.client_name as "Имя в уведомлении (Данияр?)",
    cons.client_phone,
    da.contact_name as "Реальное имя клиента",
    da.contact_phone as "Реальный телефон клиента",
    c.name as consultant_name,
    cons.created_at
FROM consultations cons
LEFT JOIN dialog_analysis da ON da.id = cons.dialog_analysis_id
LEFT JOIN consultants c ON c.id = cons.consultant_id
WHERE cons.client_name ILIKE '%Данияр%'
   OR cons.client_name ILIKE '%Daniiar%'
   OR cons.client_name ILIKE '%Daniyar%'
ORDER BY cons.created_at DESC;

-- =============================================
-- ПРОВЕРКА: Есть ли клиент "Данияр" который мог быть перепутан
-- =============================================

SELECT
    '--- Клиенты с именем "Данияр" в dialog_analysis ---' as separator;

SELECT
    da.id,
    da.contact_name,
    da.contact_phone,
    da.instance_name,
    da.created_at,
    da.updated_at,

    -- Есть ли консультации с этим dialog_analysis_id
    (
        SELECT COUNT(*)
        FROM consultations
        WHERE dialog_analysis_id = da.id
    ) as consultations_count

FROM dialog_analysis da
WHERE da.contact_name ILIKE '%Данияр%'
   OR da.contact_name ILIKE '%Daniiar%'
   OR da.contact_name ILIKE '%Daniyar%'
ORDER BY da.created_at DESC;

-- =============================================
-- ИТОГОВЫЙ ОТЧЁТ
-- =============================================

DO $$
DECLARE
    v_total_mismatches INTEGER;
    v_name_mismatches INTEGER;
    v_phone_mismatches INTEGER;
    v_daniiar_consultations INTEGER;
    v_daniiar_leads INTEGER;
BEGIN
    -- Считаем несоответствия
    SELECT COUNT(*) INTO v_total_mismatches
    FROM consultations cons
    LEFT JOIN dialog_analysis da ON da.id = cons.dialog_analysis_id
    WHERE cons.dialog_analysis_id IS NOT NULL
      AND (
        cons.client_name IS DISTINCT FROM da.contact_name
        OR cons.client_phone != da.contact_phone
      );

    SELECT COUNT(*) INTO v_name_mismatches
    FROM consultations cons
    LEFT JOIN dialog_analysis da ON da.id = cons.dialog_analysis_id
    WHERE cons.dialog_analysis_id IS NOT NULL
      AND cons.client_name IS DISTINCT FROM da.contact_name;

    SELECT COUNT(*) INTO v_phone_mismatches
    FROM consultations cons
    LEFT JOIN dialog_analysis da ON da.id = cons.dialog_analysis_id
    WHERE cons.dialog_analysis_id IS NOT NULL
      AND cons.client_phone != da.contact_phone;

    SELECT COUNT(*) INTO v_daniiar_consultations
    FROM consultations
    WHERE client_name ILIKE '%Данияр%'
       OR client_name ILIKE '%Daniiar%'
       OR client_name ILIKE '%Daniyar%';

    SELECT COUNT(*) INTO v_daniiar_leads
    FROM dialog_analysis
    WHERE contact_name ILIKE '%Данияр%'
       OR contact_name ILIKE '%Daniiar%'
       OR contact_name ILIKE '%Daniyar%';

    RAISE NOTICE '========================================';
    RAISE NOTICE 'ОТЧЁТ: Неправильные уведомления';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Всего несоответствий: %', v_total_mismatches;
    RAISE NOTICE '  - Имена не совпадают: %', v_name_mismatches;
    RAISE NOTICE '  - Телефоны не совпадают: %', v_phone_mismatches;
    RAISE NOTICE '';
    RAISE NOTICE 'Записей с "Данияр":';
    RAISE NOTICE '  - В consultations: %', v_daniiar_consultations;
    RAISE NOTICE '  - В dialog_analysis: %', v_daniiar_leads;
    RAISE NOTICE '';

    IF v_total_mismatches > 0 THEN
        RAISE WARNING '🔴 ПРОБЛЕМА: Найдены консультации где данные не совпадают с dialog_analysis!';
        RAISE WARNING 'Возможные причины:';
        RAISE WARNING '  1. При создании консультации указан неправильный dialog_analysis_id';
        RAISE WARNING '  2. Данные в dialog_analysis изменились после создания консультации';
        RAISE WARNING '  3. Бот перепутал клиентов при записи на консультацию';
    ELSE
        RAISE NOTICE '✅ Несоответствий не найдено';
    END IF;

    RAISE NOTICE '========================================';
END$$;
