-- Migration 187: Fix leads ownership mismatch
-- Проблема: в таблице leads есть записи где user_account_id не соответствует владельцу account_id
-- Например, 844 лида принадлежат performante по user_account_id, но account_id указывает на аккаунт testagency

-- ===================================
-- Шаг 0: Создание бэкапа (КРИТИЧНО!)
-- ===================================
-- ВАЖНО: Выполнить вручную перед применением миграции:
-- CREATE TABLE leads_backup_2026_02_02 AS SELECT * FROM leads;

-- ===================================
-- Шаг 1: Диагностика проблемы
-- ===================================
-- Проверяем сколько записей с несоответствием
DO $$
DECLARE
    mismatched_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO mismatched_count
    FROM leads l
    JOIN ad_accounts a ON l.account_id = a.id
    WHERE l.user_account_id != a.user_account_id;

    RAISE NOTICE 'Найдено записей с несоответствием: %', mismatched_count;
END $$;

-- Детальная статистика по пользователям
SELECT
    l.user_account_id as wrong_user_id,
    ua1.username as wrong_username,
    a.user_account_id as correct_user_id,
    ua2.username as correct_username,
    a.name as account_name,
    COUNT(*) as mismatched_count,
    MIN(l.created_at) as first_lead_date,
    MAX(l.created_at) as last_lead_date
FROM leads l
JOIN ad_accounts a ON l.account_id = a.id
LEFT JOIN user_accounts ua1 ON l.user_account_id = ua1.id
LEFT JOIN user_accounts ua2 ON a.user_account_id = ua2.id
WHERE l.user_account_id != a.user_account_id
GROUP BY l.user_account_id, ua1.username, a.user_account_id, ua2.username, a.name
ORDER BY mismatched_count DESC;

-- ===================================
-- Шаг 2: Исправление данных
-- ===================================
-- Обновляем user_account_id на правильный (из ad_accounts)
UPDATE leads l
SET user_account_id = a.user_account_id
FROM ad_accounts a
WHERE l.account_id = a.id
  AND l.user_account_id != a.user_account_id;

-- ===================================
-- Шаг 3: Проверка результата
-- ===================================
-- Должно вернуть 0 строк
SELECT
    COUNT(*) as remaining_mismatches,
    l.user_account_id as lead_user_id,
    a.user_account_id as account_owner
FROM leads l
JOIN ad_accounts a ON l.account_id = a.id
WHERE l.user_account_id != a.user_account_id
GROUP BY l.user_account_id, a.user_account_id;

-- ===================================
-- Шаг 4: Финальная статистика
-- ===================================
DO $$
DECLARE
    total_leads INTEGER;
    leads_with_account INTEGER;
    leads_without_account INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_leads FROM leads;
    SELECT COUNT(*) INTO leads_with_account FROM leads WHERE account_id IS NOT NULL;
    SELECT COUNT(*) INTO leads_without_account FROM leads WHERE account_id IS NULL;

    RAISE NOTICE '=== Финальная статистика ===';
    RAISE NOTICE 'Всего лидов: %', total_leads;
    RAISE NOTICE 'Лидов с account_id: %', leads_with_account;
    RAISE NOTICE 'Лидов без account_id (legacy): %', leads_without_account;
END $$;

-- ===================================
-- ОТКАТ (если понадобится)
-- ===================================
-- Восстановление из бэкапа:
-- TRUNCATE leads;
-- INSERT INTO leads SELECT * FROM leads_backup_2026_02_02;

-- Удаление бэкапа (через неделю после успешной миграции):
-- DROP TABLE leads_backup_2026_02_02;
