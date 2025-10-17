-- Добавление поля instagram_username в таблицу user_accounts
ALTER TABLE user_accounts 
ADD COLUMN instagram_username TEXT NULL;

-- Комментарий для поля
COMMENT ON COLUMN user_accounts.instagram_username IS 'Имя пользователя Instagram (@username)';

-- Проверка добавленного поля
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'user_accounts' 
AND column_name = 'instagram_username'; 