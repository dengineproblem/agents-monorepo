-- Migration: Add whatsapp_conversions objective and optimization_level
-- This adds a new objective type and stores the CAPI optimization level

-- 1. Drop old constraint and add new one with whatsapp_conversions (account_directions)
ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS check_objective;

ALTER TABLE account_directions
  ADD CONSTRAINT check_objective CHECK (objective IN ('whatsapp', 'whatsapp_conversions', 'instagram_traffic', 'site_leads', 'lead_forms'));

-- 2. Drop old constraint and add new one with whatsapp_conversions (default_ad_settings)
ALTER TABLE default_ad_settings
  DROP CONSTRAINT IF EXISTS default_ad_settings_campaign_goal_check;

ALTER TABLE default_ad_settings
  ADD CONSTRAINT default_ad_settings_campaign_goal_check
  CHECK (campaign_goal IN ('whatsapp', 'whatsapp_conversions', 'instagram_traffic', 'site_leads', 'lead_forms'));

-- 3. Add optimization_level column
ALTER TABLE account_directions
ADD COLUMN IF NOT EXISTS optimization_level TEXT DEFAULT 'level_1';

COMMENT ON COLUMN account_directions.optimization_level IS
  'Meta CAPI optimization level for whatsapp_conversions objective: level_1 (ViewContent), level_2 (CompleteRegistration), level_3 (Purchase)';

-- 4. Add use_instagram column (default true for backwards compatibility)
ALTER TABLE account_directions
ADD COLUMN IF NOT EXISTS use_instagram BOOLEAN DEFAULT true;

COMMENT ON COLUMN account_directions.use_instagram IS
  'Использовать Instagram аккаунт для показа рекламы. Если false - реклама показывается от имени Facebook страницы';
