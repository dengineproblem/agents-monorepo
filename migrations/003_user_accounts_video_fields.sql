-- Миграция: Добавление полей для video processing в user_accounts
-- Дата: 2025-10-05
-- Описание: Добавляем instagram_id и instagram_username для создания креативов

-- Добавляем поля для Instagram (если еще не существуют)
DO $$ 
BEGIN
    -- Instagram Business Account ID
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='user_accounts' AND column_name='instagram_id') THEN
        ALTER TABLE user_accounts ADD COLUMN instagram_id TEXT;
    END IF;

    -- Instagram Username (опционально)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='user_accounts' AND column_name='instagram_username') THEN
        ALTER TABLE user_accounts ADD COLUMN instagram_username TEXT;
    END IF;
END $$;

-- Комментарии
COMMENT ON COLUMN user_accounts.instagram_id IS 'Instagram Business Account ID для создания креативов';
COMMENT ON COLUMN user_accounts.instagram_username IS 'Instagram username для ссылок в креативах (опционально)';
