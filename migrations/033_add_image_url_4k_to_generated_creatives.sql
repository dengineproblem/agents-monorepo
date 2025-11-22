-- Добавляем поле для хранения 4K версии изображения
-- 2K версия генерируется сразу для preview
-- 4K версия создаётся при скачивании/финальном использовании

ALTER TABLE generated_creatives
ADD COLUMN IF NOT EXISTS image_url_4k TEXT;

COMMENT ON COLUMN generated_creatives.image_url_4k IS '4K версия изображения (upscale from 2K), создаётся при скачивании или финальном использовании креатива';
