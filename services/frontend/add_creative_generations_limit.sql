-- Добавление колонки для лимита генераций креативов
ALTER TABLE user_accounts 
ADD COLUMN creative_generations_available INTEGER DEFAULT 0;

-- Комментарий для колонки
COMMENT ON COLUMN user_accounts.creative_generations_available IS 'Количество доступных генераций креативов для пользователя';

-- Можно установить начальное значение для существующих пользователей (например, 3 бесплатные генерации)
-- UPDATE user_accounts SET creative_generations_available = 3 WHERE creative_generations_available = 0; 