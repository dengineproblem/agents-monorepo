-- Миграция: заполнение связей для существующих image/carousel креативов
-- Запустить после 049_add_generated_creative_link.sql

-- 1. Заполняем generated_creative_id для image креативов
-- Логика: ищем generated_creatives с таким же user_id и похожим title (offer)
UPDATE user_creatives uc
SET generated_creative_id = gc.id,
    image_url = COALESCE(gc.image_url_4k, gc.image_url)
FROM generated_creatives gc
WHERE uc.media_type = 'image'
  AND uc.generated_creative_id IS NULL
  AND uc.user_id = gc.user_id
  AND gc.creative_type = 'image'
  AND (
    -- Совпадение по title = offer
    uc.title = gc.offer
    OR
    -- Или по времени создания (в пределах 5 минут)
    (ABS(EXTRACT(EPOCH FROM (uc.created_at - gc.created_at))) < 300)
  );

-- 2. Заполняем generated_creative_id и carousel_data для carousel креативов
UPDATE user_creatives uc
SET generated_creative_id = gc.id,
    carousel_data = gc.carousel_data
FROM generated_creatives gc
WHERE uc.media_type = 'carousel'
  AND uc.generated_creative_id IS NULL
  AND uc.user_id = gc.user_id
  AND gc.creative_type = 'carousel'
  AND gc.carousel_data IS NOT NULL
  -- Сопоставляем по времени создания (в пределах 5 минут)
  AND ABS(EXTRACT(EPOCH FROM (uc.created_at - gc.created_at))) < 300;

-- 3. Проверка результатов
SELECT
  media_type,
  COUNT(*) as total,
  COUNT(generated_creative_id) as with_link,
  COUNT(image_url) as with_image,
  COUNT(carousel_data) as with_carousel
FROM user_creatives
WHERE media_type IN ('image', 'carousel')
GROUP BY media_type;
