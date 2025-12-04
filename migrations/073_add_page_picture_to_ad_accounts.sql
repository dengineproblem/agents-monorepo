-- Миграция: добавить поле для аватара Facebook страницы
-- Аватар получаем через Graph API: https://graph.facebook.com/{page_id}/picture

-- Добавляем поле в ad_accounts
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS page_picture_url TEXT;

-- Добавляем поле в user_accounts (для legacy режима)
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS page_picture_url TEXT;
