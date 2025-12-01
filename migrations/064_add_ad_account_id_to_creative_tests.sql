-- Migration: Add account_id to creative_tests for multi-account support
-- Created: 2025-12-01
-- Description: Adds account_id column (UUID FK to ad_accounts.id) for multi-account mode
--
-- NAMING CONVENTION:
--   ad_account_id = Facebook Ad Account ID (act_123456) - TEXT field
--   account_id = UUID reference to ad_accounts.id - UUID FK field

-- Add account_id column (nullable for backward compatibility with legacy mode)
ALTER TABLE creative_tests
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

-- Create index for faster lookups by account_id
CREATE INDEX IF NOT EXISTS idx_creative_tests_account_id
ON creative_tests(account_id)
WHERE account_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN creative_tests.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
