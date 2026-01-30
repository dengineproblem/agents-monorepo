-- Fix user_ai_limits table to allow telegram_id only records
-- Проблема: user_account_id NOT NULL, но для Telegram пользователей может не быть user_account_id

ALTER TABLE user_ai_limits
  DROP CONSTRAINT user_ai_limits_pkey,
  ALTER COLUMN user_account_id DROP NOT NULL,
  ADD PRIMARY KEY (telegram_id);

-- Создать индекс для быстрого поиска по user_account_id
CREATE INDEX idx_user_ai_limits_user_account ON user_ai_limits(user_account_id) WHERE user_account_id IS NOT NULL;

-- user_ai_usage также сделать user_account_id nullable
ALTER TABLE user_ai_usage
  ALTER COLUMN user_account_id DROP NOT NULL;

COMMENT ON TABLE user_ai_limits IS 'AI spending limits per Telegram user. user_account_id is optional for Telegram-only users.';
COMMENT ON TABLE user_ai_usage IS 'AI usage tracking per Telegram user. user_account_id is optional for Telegram-only users.';
