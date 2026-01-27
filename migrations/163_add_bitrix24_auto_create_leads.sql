-- Migration: Add bitrix24_auto_create_leads setting
-- Enables automatic lead creation in Bitrix24 when receiving leads from Facebook Lead Forms

-- Add column to user_accounts (legacy mode)
ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_auto_create_leads BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN user_accounts.bitrix24_auto_create_leads IS
  'Automatically create leads in Bitrix24 when receiving from Facebook Lead Forms';

-- Add column to ad_accounts (multi-account mode)
ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_auto_create_leads BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN ad_accounts.bitrix24_auto_create_leads IS
  'Automatically create leads in Bitrix24 when receiving from Facebook Lead Forms';
