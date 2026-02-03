-- Миграция: Включить unlimited лимит для dev пользователя (Анатолий)
-- Дата: 2026-02-03
-- Автор: Claude Code

BEGIN;

-- Установить is_unlimited = true для Telegram ID 313145981
INSERT INTO user_ai_limits (telegram_id, daily_limit_usd, is_unlimited)
VALUES ('313145981', 1.00, true)
ON CONFLICT (telegram_id)
DO UPDATE SET is_unlimited = true;

-- Очистить текущий дневной расход (чтобы можно было сразу использовать)
DELETE FROM user_ai_usage
WHERE telegram_id = '313145981'
  AND date = CURRENT_DATE;

COMMIT;

-- Проверка
SELECT telegram_id, daily_limit_usd, is_unlimited, created_at, updated_at
FROM user_ai_limits
WHERE telegram_id = '313145981';
