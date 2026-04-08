-- Migration 249: Separate Bitrix24 source IDs per ad platform
-- Allows configuring different SOURCE_ID for Facebook and TikTok leads

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_facebook_source_id TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_tiktok_source_id TEXT;

ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_facebook_source_id TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_tiktok_source_id TEXT;

COMMENT ON COLUMN user_accounts.bitrix24_facebook_source_id IS 'Bitrix24 SOURCE_ID for Facebook Lead Form leads (overrides bitrix24_default_source_id)';
COMMENT ON COLUMN user_accounts.bitrix24_tiktok_source_id IS 'Bitrix24 SOURCE_ID for TikTok Instant Form leads (overrides bitrix24_default_source_id)';
COMMENT ON COLUMN ad_accounts.bitrix24_facebook_source_id IS 'Bitrix24 SOURCE_ID for Facebook Lead Form leads (overrides bitrix24_default_source_id)';
COMMENT ON COLUMN ad_accounts.bitrix24_tiktok_source_id IS 'Bitrix24 SOURCE_ID for TikTok Instant Form leads (overrides bitrix24_default_source_id)';
