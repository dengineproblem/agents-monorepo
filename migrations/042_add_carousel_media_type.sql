-- Migration: Add carousel media_type to user_creatives
-- Description: Extends media_type CHECK constraint to support 'carousel' type

-- 1. Drop the existing CHECK constraint
ALTER TABLE user_creatives
DROP CONSTRAINT IF EXISTS user_creatives_media_type_check;

-- 2. Add new CHECK constraint with 'carousel' support
ALTER TABLE user_creatives
ADD CONSTRAINT user_creatives_media_type_check
CHECK (media_type IN ('video', 'image', 'carousel'));

-- 3. Update comment
COMMENT ON COLUMN user_creatives.media_type IS 'Тип медиа: video (видео), image (изображение) или carousel (карусель)';
