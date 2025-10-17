-- Добавление дополнительных Telegram ID для множественных получателей отчетов
ALTER TABLE user_accounts 
ADD COLUMN IF NOT EXISTS telegram_id_2 TEXT,
ADD COLUMN IF NOT EXISTS telegram_id_3 TEXT,
ADD COLUMN IF NOT EXISTS telegram_id_4 TEXT;

-- Добавление колонок для настроек бюджета (в центах для точности)
ALTER TABLE user_accounts 
ADD COLUMN IF NOT EXISTS plan_daily_budget_cents INTEGER,
ADD COLUMN IF NOT EXISTS default_cpl_target_cents INTEGER;

-- Комментарии для документации
COMMENT ON COLUMN user_accounts.telegram_id IS 'Основной Telegram ID для отчетов';
COMMENT ON COLUMN user_accounts.telegram_id_2 IS 'Дополнительный Telegram ID для отчетов #2';
COMMENT ON COLUMN user_accounts.telegram_id_3 IS 'Дополнительный Telegram ID для отчетов #3';
COMMENT ON COLUMN user_accounts.telegram_id_4 IS 'Дополнительный Telegram ID для отчетов #4';
COMMENT ON COLUMN user_accounts.plan_daily_budget_cents IS 'Максимальный дневной бюджет в центах USD (для точности расчетов)';
COMMENT ON COLUMN user_accounts.default_cpl_target_cents IS 'Плановая стоимость заявки в центах USD (целевой CPL)';
