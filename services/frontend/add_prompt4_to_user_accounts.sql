-- Добавление колонки prompt4 в таблицу user_accounts
ALTER TABLE user_accounts ADD COLUMN prompt4 TEXT;

-- Комментарий для ясности
COMMENT ON COLUMN user_accounts.prompt4 IS 'Промпт для генерации CTA в креативах'; 