-- Rename whatsapp_conversions -> conversions (universal CAPI optimization)
-- Add conversion_channel field for selecting channel within conversions objective

-- 1. Add conversion_channel column
ALTER TABLE account_directions
ADD COLUMN IF NOT EXISTS conversion_channel TEXT;

COMMENT ON COLUMN account_directions.conversion_channel IS
  'Channel for objective=conversions: whatsapp, lead_form, site';

-- 2. DROP old constraints FIRST (before any data changes)
ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS check_objective;

ALTER TABLE default_ad_settings
  DROP CONSTRAINT IF EXISTS default_ad_settings_campaign_goal_check;

-- 3. Migrate existing whatsapp_conversions -> conversions + channel=whatsapp
UPDATE account_directions
SET objective = 'conversions', conversion_channel = 'whatsapp'
WHERE objective = 'whatsapp_conversions';

UPDATE default_ad_settings
SET campaign_goal = 'conversions'
WHERE campaign_goal = 'whatsapp_conversions';

-- 4. Add new constraints
ALTER TABLE account_directions
  ADD CONSTRAINT check_objective
  CHECK (objective IN (
    'whatsapp',
    'conversions',
    'instagram_traffic',
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
    'site_leads',
    'lead_forms',
    'app_installs'
  ));

-- 5. Add constraint: conversion_channel required for conversions, NULL otherwise
ALTER TABLE account_directions
  ADD CONSTRAINT check_conversion_channel CHECK (
    (objective = 'conversions' AND conversion_channel IN ('whatsapp', 'lead_form', 'site'))
    OR (objective != 'conversions' AND conversion_channel IS NULL)
  );
