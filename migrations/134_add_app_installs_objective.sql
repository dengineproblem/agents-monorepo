-- Migration: Add app_installs objective for mobile app promotion campaigns
-- Description: Adds support for Facebook App Install campaigns as a new objective

-- 1. Add app_id and app_store_url columns to default_ad_settings
-- Support for separate iOS and Android URLs
ALTER TABLE default_ad_settings
  ADD COLUMN IF NOT EXISTS app_id TEXT,
  ADD COLUMN IF NOT EXISTS app_store_url_ios TEXT,
  ADD COLUMN IF NOT EXISTS app_store_url_android TEXT;

COMMENT ON COLUMN default_ad_settings.app_id IS 'Facebook Application ID for app_installs objective';
COMMENT ON COLUMN default_ad_settings.app_store_url_ios IS 'iOS App Store URL for app_installs objective';
COMMENT ON COLUMN default_ad_settings.app_store_url_android IS 'Google Play Store URL for app_installs objective';

-- 2. Add fb_creative_id_app_installs column to user_creatives
ALTER TABLE user_creatives
  ADD COLUMN IF NOT EXISTS fb_creative_id_app_installs TEXT;

COMMENT ON COLUMN user_creatives.fb_creative_id_app_installs IS 'Facebook Creative ID for App Install campaigns';

-- 3. Update the objective CHECK constraint on account_directions
ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS check_objective;

ALTER TABLE account_directions
  ADD CONSTRAINT check_objective CHECK (
    objective IN ('whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms', 'app_installs')
  );

-- 4. Update the campaign_goal CHECK constraint on default_ad_settings
ALTER TABLE default_ad_settings
  DROP CONSTRAINT IF EXISTS default_ad_settings_campaign_goal_check;

ALTER TABLE default_ad_settings
  ADD CONSTRAINT default_ad_settings_campaign_goal_check CHECK (
    campaign_goal IN ('whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms', 'app_installs')
  );

-- 5. Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_creatives_fb_creative_id_app_installs
  ON user_creatives(fb_creative_id_app_installs)
  WHERE fb_creative_id_app_installs IS NOT NULL;
