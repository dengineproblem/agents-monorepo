-- Установка демонстрационных значений для счетчика генераций креативов
-- Выполните этот SQL после применения add_creative_generations_limit.sql

-- Установить 3 бесплатные генерации всем существующим пользователям
UPDATE user_accounts 
SET creative_generations_available = 3 
WHERE creative_generations_available = 0 OR creative_generations_available IS NULL;

-- Пример: установить больше генераций конкретному пользователю (замените YOUR_USER_ID)
-- UPDATE user_accounts 
-- SET creative_generations_available = 10 
-- WHERE id = 'YOUR_USER_ID';

-- Проверка результата
SELECT username, creative_generations_available 
FROM user_accounts 
WHERE creative_generations_available > 0
ORDER BY creative_generations_available DESC; 