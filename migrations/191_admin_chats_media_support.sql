-- Migration: Add media support to admin_user_chats
-- Description: Добавление поддержки голосовых сообщений и фото в чате техподдержки
-- Date: 2026-02-04

-- Добавляем поля для хранения метаданных медиа-файлов
ALTER TABLE admin_user_chats
ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) CHECK (media_type IN ('voice', 'photo', 'text'));

ALTER TABLE admin_user_chats
ADD COLUMN IF NOT EXISTS media_url TEXT;

ALTER TABLE admin_user_chats
ADD COLUMN IF NOT EXISTS media_metadata JSONB;

-- Делаем message nullable (для голосовых сообщений без текста)
ALTER TABLE admin_user_chats
ALTER COLUMN message DROP NOT NULL;

-- Добавляем constraint: либо message, либо media должны присутствовать
ALTER TABLE admin_user_chats
ADD CONSTRAINT chk_message_or_media
CHECK (message IS NOT NULL OR (media_type IS NOT NULL AND media_url IS NOT NULL));

-- Индекс для эффективного поиска по типу медиа
CREATE INDEX IF NOT EXISTS idx_admin_user_chats_media_type
ON admin_user_chats(media_type) WHERE media_type IS NOT NULL;

-- Комментарии для документации
COMMENT ON COLUMN admin_user_chats.media_type IS 'Тип медиа: voice (голосовое), photo (фото), text (текст)';
COMMENT ON COLUMN admin_user_chats.media_url IS 'Публичный URL файла в Supabase Storage (для voice/photo)';
COMMENT ON COLUMN admin_user_chats.media_metadata IS 'JSON метаданные: {duration, file_size, width, height, original_telegram_file_id}';
