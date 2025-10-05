-- Тест обновления geo_locations формата

-- Вариант 1: Страны (Россия + Казахстан)
UPDATE default_ad_settings
SET geo_locations = '{"countries": ["RU", "KZ"]}'::jsonb
WHERE user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' 
  AND campaign_goal = 'whatsapp';

-- Проверка
SELECT 
  user_id,
  campaign_goal,
  cities,
  geo_locations,
  age_min,
  age_max
FROM default_ad_settings
WHERE user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

-- Пример 2: Города (Алматы + Астана) с радиусом
-- UPDATE default_ad_settings
-- SET geo_locations = '{
--   "cities": [
--     {"key": "2420877", "radius": 25, "distance_unit": "kilometer"},
--     {"key": "2452344", "radius": 25, "distance_unit": "kilometer"}
--   ]
-- }'::jsonb
-- WHERE user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' 
--   AND campaign_goal = 'whatsapp';
