-- Добавление колонок для сайта и пикселя Facebook в таблицу user_accounts

ALTER TABLE user_accounts
ADD COLUMN site_url TEXT NULL,
ADD COLUMN facebook_pixel_id TEXT NULL;

COMMENT ON COLUMN user_accounts.site_url IS 'URL сайта клиента, используется для цели Лиды на сайте';
COMMENT ON COLUMN user_accounts.facebook_pixel_id IS 'ID Facebook Pixel, выбранный для отслеживания';

