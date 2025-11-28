-- Миграция: улучшенное заполнение связей для существующих image/carousel креативов
-- Более агрессивный поиск: расширенное временное окно и дополнительные критерии

-- 1. IMAGE креативы: расширяем окно до 1 часа и добавляем поиск по частичному совпадению title
UPDATE user_creatives uc
SET generated_creative_id = gc.id,
    image_url = COALESCE(gc.image_url_4k, gc.image_url)
FROM generated_creatives gc
WHERE uc.media_type = 'image'
  AND uc.generated_creative_id IS NULL
  AND uc.user_id = gc.user_id
  AND gc.creative_type = 'image'
  AND (gc.image_url IS NOT NULL OR gc.image_url_4k IS NOT NULL)
  AND (
    -- Совпадение по title = offer
    uc.title = gc.offer
    OR
    -- Частичное совпадение (title содержит offer или наоборот)
    uc.title ILIKE '%' || LEFT(gc.offer, 30) || '%'
    OR
    gc.offer ILIKE '%' || LEFT(uc.title, 30) || '%'
    OR
    -- По времени создания (в пределах 1 часа)
    ABS(EXTRACT(EPOCH FROM (uc.created_at - gc.created_at))) < 3600
  );

-- 2. CAROUSEL креативы: расширяем окно до 1 часа
UPDATE user_creatives uc
SET generated_creative_id = gc.id,
    carousel_data = gc.carousel_data
FROM generated_creatives gc
WHERE uc.media_type = 'carousel'
  AND uc.generated_creative_id IS NULL
  AND uc.user_id = gc.user_id
  AND gc.creative_type = 'carousel'
  AND gc.carousel_data IS NOT NULL
  -- По времени создания (в пределах 1 часа)
  AND ABS(EXTRACT(EPOCH FROM (uc.created_at - gc.created_at))) < 3600;

-- 3. Для оставшихся IMAGE без связи: берём последний generated_creative того же пользователя
-- (если есть только один image креатив от этого пользователя)
UPDATE user_creatives uc
SET generated_creative_id = subq.gc_id,
    image_url = subq.img_url
FROM (
  SELECT
    uc2.id as uc_id,
    gc2.id as gc_id,
    COALESCE(gc2.image_url_4k, gc2.image_url) as img_url,
    ROW_NUMBER() OVER (PARTITION BY uc2.id ORDER BY gc2.created_at DESC) as rn
  FROM user_creatives uc2
  JOIN generated_creatives gc2 ON uc2.user_id = gc2.user_id
  WHERE uc2.media_type = 'image'
    AND uc2.generated_creative_id IS NULL
    AND gc2.creative_type = 'image'
    AND (gc2.image_url IS NOT NULL OR gc2.image_url_4k IS NOT NULL)
) subq
WHERE uc.id = subq.uc_id
  AND subq.rn = 1;

-- 4. Для оставшихся CAROUSEL без связи: берём последний carousel того же пользователя
UPDATE user_creatives uc
SET generated_creative_id = subq.gc_id,
    carousel_data = subq.cdata
FROM (
  SELECT
    uc2.id as uc_id,
    gc2.id as gc_id,
    gc2.carousel_data as cdata,
    ROW_NUMBER() OVER (PARTITION BY uc2.id ORDER BY gc2.created_at DESC) as rn
  FROM user_creatives uc2
  JOIN generated_creatives gc2 ON uc2.user_id = gc2.user_id
  WHERE uc2.media_type = 'carousel'
    AND uc2.generated_creative_id IS NULL
    AND gc2.creative_type = 'carousel'
    AND gc2.carousel_data IS NOT NULL
) subq
WHERE uc.id = subq.uc_id
  AND subq.rn = 1;

-- 5. Проверка результатов
SELECT
  media_type,
  COUNT(*) as total,
  COUNT(generated_creative_id) as with_link,
  COUNT(image_url) as with_image,
  COUNT(carousel_data) as with_carousel
FROM user_creatives
WHERE media_type IN ('image', 'carousel')
GROUP BY media_type;
