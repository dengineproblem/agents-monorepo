-- Migration 165: Add account_id to bitrix24_pipeline_stages for multi-account support
--
-- In multi-account mode, each ad_account can have its own Bitrix24 connection
-- (different portal), so pipelines need to be stored per account_id.

-- Add account_id column
ALTER TABLE bitrix24_pipeline_stages
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES ad_accounts(id) ON DELETE CASCADE;

COMMENT ON COLUMN bitrix24_pipeline_stages.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_bitrix24_pipeline_stages_account_id
  ON bitrix24_pipeline_stages(account_id) WHERE account_id IS NOT NULL;

-- Update unique constraint to include account_id
-- First drop existing unique constraint if any
DROP INDEX IF EXISTS idx_bitrix24_pipeline_unique_stage;

-- Create new unique constraint that handles both legacy (account_id IS NULL) and multi-account mode
CREATE UNIQUE INDEX idx_bitrix24_pipeline_unique_stage
  ON bitrix24_pipeline_stages(user_account_id, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, category_id, status_id);
