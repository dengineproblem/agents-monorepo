-- Migration: Add Bitrix24 default stage settings
-- Stores the default pipeline/stage for auto-created leads in Bitrix24

-- Add columns to user_accounts (legacy mode)
ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_default_lead_status TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_default_deal_category INTEGER,
  ADD COLUMN IF NOT EXISTS bitrix24_default_deal_stage TEXT;

COMMENT ON COLUMN user_accounts.bitrix24_default_lead_status IS
  'Default STATUS_ID for new leads in Bitrix24 (e.g., "NEW", "IN_PROCESS")';

COMMENT ON COLUMN user_accounts.bitrix24_default_deal_category IS
  'Default CATEGORY_ID (pipeline) for new deals in Bitrix24';

COMMENT ON COLUMN user_accounts.bitrix24_default_deal_stage IS
  'Default STAGE_ID for new deals in Bitrix24 (e.g., "C1:NEW")';

-- Add columns to ad_accounts (multi-account mode)
ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_default_lead_status TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_default_deal_category INTEGER,
  ADD COLUMN IF NOT EXISTS bitrix24_default_deal_stage TEXT;

COMMENT ON COLUMN ad_accounts.bitrix24_default_lead_status IS
  'Default STATUS_ID for new leads in Bitrix24 (e.g., "NEW", "IN_PROCESS")';

COMMENT ON COLUMN ad_accounts.bitrix24_default_deal_category IS
  'Default CATEGORY_ID (pipeline) for new deals in Bitrix24';

COMMENT ON COLUMN ad_accounts.bitrix24_default_deal_stage IS
  'Default STAGE_ID for new deals in Bitrix24 (e.g., "C1:NEW")';
