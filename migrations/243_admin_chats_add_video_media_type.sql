-- Migration: Add video media_type support in admin_user_chats
-- Description: Добавление поддержки видео в чате админки
-- Date: 2026-04-02

-- Убираем старый constraint
ALTER TABLE admin_user_chats DROP CONSTRAINT IF EXISTS admin_user_chats_media_type_check;

-- Добавляем расширенный constraint с video
ALTER TABLE admin_user_chats
ADD CONSTRAINT admin_user_chats_media_type_check
CHECK (media_type IN ('voice', 'photo', 'text', 'document', 'audio', 'video'));

-- Обновляем комментарий
COMMENT ON COLUMN admin_user_chats.media_type IS 'Тип медиа: voice, photo, text, document, audio, video';
