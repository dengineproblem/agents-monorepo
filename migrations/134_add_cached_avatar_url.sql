-- Миграция: добавить поле для кэшированного аватара в Supabase Storage
-- Решает проблему истекающих URL Facebook CDN для аватаров страниц

-- Добавляем поле в ad_accounts
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS cached_page_picture_url TEXT;

-- Комментарий для понимания
COMMENT ON COLUMN ad_accounts.cached_page_picture_url IS 'Постоянный URL аватара в Supabase Storage (не истекает, в отличие от FB CDN)';
