-- Добавляем gemini_api_key в user_accounts (shared, верхний уровень)
-- Ранее хранился только в ad_accounts, теперь все API ключи shared
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;
