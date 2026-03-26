-- Migration: Add Bitrix24 default source ID setting
-- Stores the SOURCE_ID for auto-created leads/deals/contacts in Bitrix24
-- Each Bitrix24 account has its own custom source IDs (UC_* prefixed)

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_default_source_id TEXT;

COMMENT ON COLUMN user_accounts.bitrix24_default_source_id IS
  'Default SOURCE_ID for new entities in Bitrix24 (e.g., "UC_8NJU8B" for "[Instagram] - Target")';

ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_default_source_id TEXT;

COMMENT ON COLUMN ad_accounts.bitrix24_default_source_id IS
  'Default SOURCE_ID for new entities in Bitrix24 (e.g., "UC_8NJU8B" for "[Instagram] - Target")';
