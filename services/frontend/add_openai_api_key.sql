-- Добавление колонки для OpenAI API ключа
ALTER TABLE user_accounts 
ADD COLUMN IF NOT EXISTS openai_api_key TEXT;

-- Комментарий для документации
COMMENT ON COLUMN user_accounts.openai_api_key IS 'OpenAI API ключ пользователя для генерации контента';

