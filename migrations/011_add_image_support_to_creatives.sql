-- Migration: Add image support to user_creatives table
-- Date: 2025-10-14
-- Description: Добавляет поддержку изображений в креативы

-- 1. Добавляем поле для типа медиа (video или image)
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'video' CHECK (media_type IN ('video', 'image'));

-- 2. Добавляем поле для хранения image_hash от Facebook
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS fb_image_hash TEXT;

-- 3. Создаем индекс для быстрого поиска по типу медиа
CREATE INDEX IF NOT EXISTS idx_user_creatives_media_type 
ON user_creatives(media_type);

-- 4. Создаем индекс для поиска по direction_id и media_type
CREATE INDEX IF NOT EXISTS idx_user_creatives_direction_media 
ON user_creatives(direction_id, media_type) 
WHERE direction_id IS NOT NULL;

-- 5. Обновляем существующие записи (все текущие креативы - видео)
UPDATE user_creatives 
SET media_type = 'video' 
WHERE media_type IS NULL;

-- 6. Комментарии
COMMENT ON COLUMN user_creatives.media_type IS 'Тип медиа: video (видео) или image (изображение)';
COMMENT ON COLUMN user_creatives.fb_image_hash IS 'Hash изображения из Facebook API (только для media_type=image)';

-- Примечание: 
-- - Для video: используется fb_video_id
-- - Для image: используется fb_image_hash
-- - fb_creative_id_* создаются для обоих типов

