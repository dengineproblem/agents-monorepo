-- Миграция: Добавление поля thumbnail_url для видео креативов
-- Дата: 2025-12-01
-- Описание: Сохранение скриншота первого кадра видео в Supabase Storage

-- Добавляем поле thumbnail_url в таблицу user_creatives
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Комментарий к полю
COMMENT ON COLUMN user_creatives.thumbnail_url IS 'URL миниатюры креатива (для видео - скриншот первого кадра из ffmpeg)';
