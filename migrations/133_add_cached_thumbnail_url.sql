-- Миграция: Добавление кэшированных URL изображений для креативов конкурентов
-- Решает проблему истекающих URL Facebook CDN

-- Добавляем колонку для кэшированного URL (Supabase Storage)
ALTER TABLE competitor_creatives
ADD COLUMN IF NOT EXISTS cached_thumbnail_url TEXT;

-- Добавляем колонку для кэшированных media URLs
ALTER TABLE competitor_creatives
ADD COLUMN IF NOT EXISTS cached_media_urls TEXT[];

-- Комментарии
COMMENT ON COLUMN competitor_creatives.cached_thumbnail_url IS 'URL превью, сохранённый в Supabase Storage (не истекает)';
COMMENT ON COLUMN competitor_creatives.cached_media_urls IS 'URLs медиа, сохранённые в Supabase Storage (не истекают)';

-- Индекс для проверки наличия кэша
CREATE INDEX IF NOT EXISTS idx_competitor_creatives_cached
ON competitor_creatives(id)
WHERE cached_thumbnail_url IS NOT NULL;
