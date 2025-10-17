-- Добавление полей TikTok в таблицу user_accounts
ALTER TABLE user_accounts 
ADD COLUMN tiktok_access_token TEXT NULL,
ADD COLUMN tiktok_account_id TEXT NULL,
ADD COLUMN tiktok_business_id TEXT NULL;

-- Комментарии для полей
COMMENT ON COLUMN user_accounts.tiktok_access_token IS 'Токен доступа к TikTok API';
COMMENT ON COLUMN user_accounts.tiktok_account_id IS 'ID аккаунта TikTok пользователя';
COMMENT ON COLUMN user_accounts.tiktok_business_id IS 'ID бизнес-аккаунта TikTok (если есть)';

-- Проверка добавленных полей
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'user_accounts' 
AND column_name LIKE 'tiktok_%'; 