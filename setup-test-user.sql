-- Скрипт для настройки тестового пользователя для video processing
-- Используем того же пользователя, что и для scoring агента

-- 1. Проверяем данные пользователя
SELECT 
  id,
  username,
  access_token IS NOT NULL as has_token,
  ad_account_id,
  page_id,
  instagram_id,
  instagram_username
FROM user_accounts 
LIMIT 1;

-- 2. Обновляем Instagram данные (замените значения на ваши)
-- UPDATE user_accounts 
-- SET 
--   instagram_id = 'ваш_instagram_business_account_id',
--   instagram_username = 'ваш_instagram_username'
-- WHERE id = (SELECT id FROM user_accounts LIMIT 1);

-- 3. Проверяем результат
-- SELECT 
--   id,
--   username,
--   access_token IS NOT NULL as has_token,
--   ad_account_id,
--   page_id,
--   instagram_id,
--   instagram_username,
--   'Все поля заполнены!' as status
-- FROM user_accounts 
-- WHERE id = (SELECT id FROM user_accounts LIMIT 1);
