-- Add app installs objective support
-- 1) Extend objective/campaign_goal constraints
-- 2) Add app settings fields to default_ad_settings

ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS check_objective;

ALTER TABLE account_directions
  ADD CONSTRAINT check_objective
  CHECK (objective IN (
    'whatsapp',
    'whatsapp_conversions',
    'instagram_traffic',
    'site_leads',
    'lead_forms',
    'app_installs'
  ));

ALTER TABLE default_ad_settings
  DROP CONSTRAINT IF EXISTS default_ad_settings_campaign_goal_check;

ALTER TABLE default_ad_settings
  ADD CONSTRAINT default_ad_settings_campaign_goal_check
  CHECK (campaign_goal IN (
    'whatsapp',
    'whatsapp_conversions',
    'instagram_traffic',
    'site_leads',
    'lead_forms',
    'app_installs'
  ));

ALTER TABLE default_ad_settings
  ADD COLUMN IF NOT EXISTS app_id TEXT;

ALTER TABLE default_ad_settings
  ADD COLUMN IF NOT EXISTS app_store_url TEXT;

ALTER TABLE default_ad_settings
  ADD COLUMN IF NOT EXISTS is_skadnetwork_attribution BOOLEAN DEFAULT false;

UPDATE default_ad_settings
SET is_skadnetwork_attribution = false
WHERE is_skadnetwork_attribution IS NULL;

COMMENT ON COLUMN default_ad_settings.app_id IS 'Meta App ID for app install campaigns';
COMMENT ON COLUMN default_ad_settings.app_store_url IS 'Store URL (App Store / Google Play) for app install campaigns';
COMMENT ON COLUMN default_ad_settings.is_skadnetwork_attribution IS 'Enable SKAdNetwork attribution for iOS app install campaigns';
