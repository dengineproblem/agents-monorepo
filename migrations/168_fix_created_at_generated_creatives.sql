-- Миграция: Заполнить NULL created_at в generated_creatives
-- Timestamp извлекается из image_url: /creatives/{user_id}/{timestamp}_{random}.png

-- Обновляем записи где created_at = NULL но есть image_url с timestamp
UPDATE generated_creatives
SET created_at = TO_TIMESTAMP(
  CAST(SPLIT_PART(SPLIT_PART(image_url, '/', -1), '_', 1) AS BIGINT) / 1000.0
)
WHERE created_at IS NULL
  AND image_url IS NOT NULL
  AND image_url LIKE '%/creatives/%';

-- Для записей без правильного формата URL - ставим текущую дату
UPDATE generated_creatives
SET created_at = NOW()
WHERE created_at IS NULL;
