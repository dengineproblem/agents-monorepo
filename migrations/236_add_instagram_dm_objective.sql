-- Add instagram_dm objective for Instagram Direct messaging campaigns

-- 1. DROP old constraints
ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS check_objective;

ALTER TABLE default_ad_settings
  DROP CONSTRAINT IF EXISTS default_ad_settings_campaign_goal_check;

-- 2. Re-create constraints with instagram_dm added
ALTER TABLE account_directions
  ADD CONSTRAINT check_objective
  CHECK (objective IN (
    'whatsapp',
    'conversions',
    'instagram_traffic',
    'instagram_dm',
    'site_leads',
    'lead_forms',
    'app_installs'
  ));

ALTER TABLE default_ad_settings
  ADD CONSTRAINT default_ad_settings_campaign_goal_check
  CHECK (campaign_goal IN (
    'whatsapp',
    'conversions',
    'instagram_traffic',
    'instagram_dm',
    'site_leads',
    'lead_forms',
    'app_installs'
  ));
