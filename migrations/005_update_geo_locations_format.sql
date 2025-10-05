-- Migration: Update geo_locations format in default_ad_settings
-- Вместо массива cities храним полный geo_locations JSON

-- Шаг 1: Добавляем новую колонку geo_locations (JSONB)
ALTER TABLE default_ad_settings 
ADD COLUMN IF NOT EXISTS geo_locations JSONB DEFAULT '{"countries": ["RU"]}'::jsonb;

-- Шаг 2: Мигрируем существующие данные из cities в geo_locations
UPDATE default_ad_settings
SET geo_locations = jsonb_build_object(
  'cities', 
  (
    SELECT jsonb_agg(jsonb_build_object('key', city_id))
    FROM unnest(cities) AS city_id
  )
)
WHERE cities IS NOT NULL AND array_length(cities, 1) > 0;

-- Шаг 3: Для пустых cities - ставим страну по умолчанию
UPDATE default_ad_settings
SET geo_locations = '{"countries": ["RU"]}'::jsonb
WHERE cities IS NULL OR array_length(cities, 1) = 0 OR cities = '{}';

-- Шаг 4: Удаляем старую колонку cities (опционально, можно оставить для обратной совместимости)
-- ALTER TABLE default_ad_settings DROP COLUMN IF EXISTS cities;

-- Комментарий для разработчиков
COMMENT ON COLUMN default_ad_settings.geo_locations IS 'Facebook geo_locations JSON: {"countries": ["RU"]} ИЛИ {"cities": [{"key": "2420877"}]}';

-- Примеры использования:
-- Страны:
-- {"countries": ["RU", "KZ"]}
--
-- Города с радиусом:
-- {"cities": [{"key": "2420877", "radius": 25, "distance_unit": "kilometer"}]}
--
-- Смешанное (города + исключения):
-- {"cities": [{"key": "2420877"}], "excluded_countries": ["BY"]}
