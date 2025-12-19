-- Migration: Add lead_forms objective and lead_form_id field
-- Description: Adds support for Facebook Lead Forms as a new campaign objective

-- 1. Add lead_form_id column to default_ad_settings
ALTER TABLE default_ad_settings
  ADD COLUMN IF NOT EXISTS lead_form_id TEXT;

COMMENT ON COLUMN default_ad_settings.lead_form_id IS 'Facebook Lead Form ID for lead_forms objective';

-- 2. Update the objective CHECK constraint on account_directions
-- First, drop the existing constraint
ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS check_objective;

-- Then add the new constraint with lead_forms included
ALTER TABLE account_directions
  ADD CONSTRAINT check_objective CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms'));

-- 3. Update the campaign_goal CHECK constraint on default_ad_settings (if exists)
ALTER TABLE default_ad_settings
  DROP CONSTRAINT IF EXISTS default_ad_settings_campaign_goal_check;

ALTER TABLE default_ad_settings
  ADD CONSTRAINT default_ad_settings_campaign_goal_check
  CHECK (campaign_goal IN ('whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms'));
