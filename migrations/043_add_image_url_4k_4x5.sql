-- Migration: Add 4:5 aspect ratio 4K image URL
-- Description: Adds column for storing 4K version in 4:5 aspect ratio for Feed placements

ALTER TABLE generated_creatives
ADD COLUMN IF NOT EXISTS image_url_4k_4x5 TEXT;

COMMENT ON COLUMN generated_creatives.image_url_4k_4x5 IS '4K версия изображения в формате 4:5 для Feed плейсментов (Instagram/Facebook Feed)';
