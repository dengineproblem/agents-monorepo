-- Migration: Add advanced campaign scoring settings
-- Date: 2025-11-14
-- Description: Flexible settings for campaign queue scoring and key stage cooldown

-- Add advanced scoring settings
ALTER TABLE campaign_settings
  ADD COLUMN IF NOT EXISTS key_stage_cooldown_days INTEGER DEFAULT 7,
  ADD COLUMN IF NOT EXISTS stage_interval_multipliers JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fatigue_thresholds JSONB DEFAULT '{}'::jsonb;

-- Comments
COMMENT ON COLUMN campaign_settings.key_stage_cooldown_days IS 
  'Days to wait after leaving key stage before including in campaign queue (default: 7)';
COMMENT ON COLUMN campaign_settings.stage_interval_multipliers IS 
  'Multipliers for touch intervals by funnel stage: {"new_lead": 0.7, "thinking": 1.2, ...}';
COMMENT ON COLUMN campaign_settings.fatigue_thresholds IS 
  'Fatigue coefficients by message count: {"3": 0.95, "6": 0.85, "10": 0.7, ...}';

-- Set default values for existing records
UPDATE campaign_settings 
SET 
  key_stage_cooldown_days = 7,
  stage_interval_multipliers = '{
    "new_lead": 0.7,
    "first_contact": 1.0,
    "thinking": 1.2,
    "no_show": 0.8,
    "price_objection": 1.2
  }'::jsonb,
  fatigue_thresholds = '{
    "0": 1.0,
    "3": 0.95,
    "6": 0.85,
    "10": 0.7,
    "11": 0.5
  }'::jsonb
WHERE key_stage_cooldown_days IS NULL;



