-- Миграция: исправление связей carousel креативов по URL картинок
-- Предыдущие миграции 050/051 неправильно связали carousel из-за NULL в created_at
-- Правильная связь определяется по совпадению URL картинок

-- 1. Исправляем связи и carousel_data для carousel креативов
-- Ищем generated_creative где первая картинка совпадает с первой картинкой в user_creative
UPDATE user_creatives uc
SET generated_creative_id = gc.id,
    carousel_data = gc.carousel_data
FROM generated_creatives gc
WHERE uc.media_type = 'carousel'
  AND uc.user_id = gc.user_id
  AND gc.creative_type = 'carousel'
  AND gc.carousel_data IS NOT NULL
  AND (
    -- Совпадение по image_url первой карточки
    gc.carousel_data->0->>'image_url' = uc.carousel_data->0->>'image_url'
    OR
    -- Или по image_url_4k первой карточки
    gc.carousel_data->0->>'image_url_4k' = uc.carousel_data->0->>'image_url'
  );

-- 2. Проверка результатов
SELECT
  uc.id,
  uc.title,
  jsonb_array_length(uc.carousel_data) as uc_cards,
  jsonb_array_length(gc.carousel_data) as gc_cards,
  uc.carousel_data = gc.carousel_data as data_matches
FROM user_creatives uc
LEFT JOIN generated_creatives gc ON uc.generated_creative_id = gc.id
WHERE uc.media_type = 'carousel'
ORDER BY uc.created_at DESC;
