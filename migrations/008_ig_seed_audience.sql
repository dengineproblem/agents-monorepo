-- Добавляем поле для хранения ID готовой LAL (Lookalike) аудитории
-- Эта LAL аудитория создается вручную в Ads Manager один раз и используется при дублировании adset'ов
-- Например: LAL 3% от Instagram Engagers 365d для Казахстана

ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS ig_seed_audience_id TEXT DEFAULT NULL;

COMMENT ON COLUMN user_accounts.ig_seed_audience_id IS 'Facebook Custom Audience ID готовой LAL аудитории (создается вручную в Ads Manager). Используется при Audience.DuplicateAdSetWithAudience с audience_id="use_lal_from_settings".';

