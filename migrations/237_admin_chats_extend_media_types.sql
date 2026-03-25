-- Migration: Extend media_type support in admin_user_chats
-- Description: Добавление поддержки документов и аудио в чате админки
-- Date: 2026-03-24

-- Убираем старый constraint (допускал только voice, photo, text)
ALTER TABLE admin_user_chats DROP CONSTRAINT IF EXISTS admin_user_chats_media_type_check;

-- Добавляем расширенный constraint
ALTER TABLE admin_user_chats
ADD CONSTRAINT admin_user_chats_media_type_check
CHECK (media_type IN ('voice', 'photo', 'text', 'document', 'audio'));

-- Обновляем комментарий
COMMENT ON COLUMN admin_user_chats.media_type IS 'Тип медиа: voice, photo, text, document, audio';
