-- Migration 188: Fix "Данияр" name bug
-- Проблема: старые записи содержат имя "Данияр" вместо правильных имен клиентов
-- Корневая причина: баг в AI боте (уже исправлен в коммите db1603e), но БД содержит старые неправильные записи
-- Документация: docs/DANIIAR_NAME_BUG_INVESTIGATION.md

-- ===================================
-- Шаг 0: Создание бэкапа (КРИТИЧНО!)
-- ===================================
-- ВАЖНО: Выполнить вручную перед применением миграции:
-- CREATE TABLE consultations_backup_2026_02_02 AS SELECT * FROM consultations;

-- ===================================
-- Шаг 1: Диагностика проблемы
-- ===================================

DO $$
DECLARE
    corrupted_consultations_count INTEGER;
BEGIN
    -- Проверяем consultations с именем "Данияр"
    SELECT COUNT(*) INTO corrupted_consultations_count
    FROM consultations
    WHERE client_name ILIKE '%Данияр%'
       OR client_name ILIKE '%Daniiar%'
       OR client_name ILIKE '%Daniyar%';

    RAISE NOTICE '=== ДИАГНОСТИКА ===';
    RAISE NOTICE 'Найдено записей с неправильным именем "Данияр":';
    RAISE NOTICE '  - В consultations: %', corrupted_consultations_count;
    RAISE NOTICE '';
END $$;

-- Детальная информация по consultations
SELECT
    '=== Consultations с неправильным именем "Данияр" ===' as report;

SELECT
    cons.id,
    cons.client_name as "❌ Неправильное имя",
    cons.client_phone,
    da.contact_name as "✅ Правильное имя",
    da.contact_phone,
    cons.created_at,
    cons.dialog_analysis_id
FROM consultations cons
LEFT JOIN dialog_analysis da ON da.id = cons.dialog_analysis_id
WHERE cons.client_name ILIKE '%Данияр%'
   OR cons.client_name ILIKE '%Daniiar%'
   OR cons.client_name ILIKE '%Daniyar%'
ORDER BY cons.created_at DESC;

-- ===================================
-- Шаг 1.5: Исправление dialog_analysis (источник проблемы)
-- ===================================

SELECT '=== ИСПРАВЛЕНИЕ DIALOG_ANALYSIS ===' as action;

-- Обнулить "Данияр" в dialog_analysis чтобы AI спросил имя заново
-- Исключаем реальных людей с фамилиями (Daniyar Zhaksybek, Данияр Кушумов, etc)
UPDATE dialog_analysis
SET contact_name = NULL
WHERE (
    contact_name ILIKE '%Данияр%'
    OR contact_name ILIKE '%Daniiar%'
    OR contact_name ILIKE '%Daniyar%'
  )
  AND contact_name NOT LIKE '%ov%'       -- исключаем Dossanov
  AND contact_name NOT LIKE '%ovna%'     -- исключаем Daniyarovna
  AND contact_name NOT LIKE '%Кушумов%'  -- исключаем Кушумов
  AND contact_name NOT LIKE '%Zhaksybek%' -- исключаем Zhaksybek
  AND LENGTH(contact_name) < 15;         -- исключаем длинные имена с фамилией

-- Проверка сколько обнулили
SELECT COUNT(*) as cleared_daniiar_records
FROM dialog_analysis
WHERE contact_name IS NULL
  AND updated_at >= NOW() - INTERVAL '1 minute';

-- ===================================
-- Шаг 2: Исправление consultations
-- ===================================

SELECT '=== ИСПРАВЛЕНИЕ CONSULTATIONS ===' as action;

-- Обновляем client_name на правильное имя из dialog_analysis
UPDATE consultations cons
SET client_name = da.contact_name
FROM dialog_analysis da
WHERE cons.dialog_analysis_id = da.id
  AND da.contact_name IS NOT NULL
  AND da.contact_name != ''
  AND (
    cons.client_name ILIKE '%Данияр%'
    OR cons.client_name ILIKE '%Daniiar%'
    OR cons.client_name ILIKE '%Daniyar%'
  );

-- ===================================
-- Шаг 3: Исправление всех несоответствий имен в consultations
-- ===================================

SELECT '=== ИСПРАВЛЕНИЕ ВСЕХ НЕСООТВЕТСТВИЙ ИМЕН ===' as action;

-- Для большей надежности, исправляем ВСЕ consultations где имя не совпадает с dialog_analysis
-- (не только "Данияр", но и другие возможные несоответствия от того же бага)
UPDATE consultations cons
SET client_name = da.contact_name
FROM dialog_analysis da
WHERE cons.dialog_analysis_id = da.id
  AND cons.dialog_analysis_id IS NOT NULL
  AND da.contact_name IS NOT NULL
  AND da.contact_name != ''
  AND cons.client_name IS DISTINCT FROM da.contact_name
  -- Исключаем случаи где намеренно используется другое имя (если такие есть)
  AND cons.created_at < '2026-02-02 05:06:00'; -- До фикса бага

-- ===================================
-- Шаг 4: Проверка результата consultations
-- ===================================

SELECT '=== ПРОВЕРКА РЕЗУЛЬТАТА ===' as validation;

-- Должно вернуть 0 строк с именем "Данияр"
SELECT
    COUNT(*) as remaining_wrong_daniiar_names
FROM consultations
WHERE client_name ILIKE '%Данияр%'
   OR client_name ILIKE '%Daniiar%'
   OR client_name ILIKE '%Daniyar%';

-- Проверка несоответствий (созданных до фикса)
SELECT
    COUNT(*) as remaining_old_mismatches
FROM consultations cons
LEFT JOIN dialog_analysis da ON da.id = cons.dialog_analysis_id
WHERE cons.dialog_analysis_id IS NOT NULL
  AND cons.client_name IS DISTINCT FROM da.contact_name
  AND cons.created_at < '2026-02-02 05:06:00';

-- ===================================
-- Шаг 5: Финальная статистика
-- ===================================

DO $$
DECLARE
    total_consultations INTEGER;
    consultations_with_dialog INTEGER;
    remaining_mismatches INTEGER;
    total_fixed INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_consultations FROM consultations;

    SELECT COUNT(*) INTO consultations_with_dialog
    FROM consultations
    WHERE dialog_analysis_id IS NOT NULL;

    SELECT COUNT(*) INTO remaining_mismatches
    FROM consultations cons
    LEFT JOIN dialog_analysis da ON da.id = cons.dialog_analysis_id
    WHERE cons.dialog_analysis_id IS NOT NULL
      AND cons.client_name IS DISTINCT FROM da.contact_name;

    total_fixed := consultations_with_dialog - remaining_mismatches;

    RAISE NOTICE '';
    RAISE NOTICE '=== ФИНАЛЬНАЯ СТАТИСТИКА ===';
    RAISE NOTICE 'Всего consultations: %', total_consultations;
    RAISE NOTICE 'С привязкой к dialog_analysis: %', consultations_with_dialog;
    RAISE NOTICE 'Исправлено записей: ~%', total_fixed;
    RAISE NOTICE 'Осталось несоответствий: %', remaining_mismatches;
    RAISE NOTICE '';

    IF remaining_mismatches > 0 THEN
        RAISE NOTICE 'Оставшиеся несоответствия могут быть:';
        RAISE NOTICE '  - Консультации созданные ПОСЛЕ фикса (нормально)';
        RAISE NOTICE '  - Консультации без dialog_analysis_id (legacy)';
        RAISE NOTICE '  - Специальные случаи где имя намеренно отличается';
    ELSE
        RAISE NOTICE '✅ Все имена синхронизированы с dialog_analysis!';
    END IF;
END $$;

-- ===================================
-- ОТКАТ (если понадобится)
-- ===================================
-- Восстановление из бэкапа:
-- TRUNCATE consultations;
-- INSERT INTO consultations SELECT * FROM consultations_backup_2026_02_02;

-- Удаление бэкапа (через неделю после успешной миграции):
-- DROP TABLE IF EXISTS consultations_backup_2026_02_02;
