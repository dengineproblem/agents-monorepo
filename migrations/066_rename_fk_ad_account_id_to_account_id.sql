-- Migration 066: Rename FK columns ad_account_id -> account_id in related tables
-- Created: 2025-12-01
-- Description: Fix naming confusion between UUID FK and Facebook Ad Account ID
--
-- NAMING CONVENTION:
--   ad_account_id = Facebook Ad Account ID (act_123456) - TEXT field
--   account_id = UUID reference to ad_accounts.id - UUID FK field
--
-- This migration renames all FK columns that reference ad_accounts(id) from
-- ad_account_id to account_id to avoid confusion with the Facebook ID field.

-- =====================================================
-- RENAME FK COLUMNS: ad_account_id -> account_id
-- Using DO blocks to safely check if column exists
-- =====================================================

-- account_directions (from migration 059)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_directions' AND column_name = 'ad_account_id') THEN
    ALTER TABLE account_directions RENAME COLUMN ad_account_id TO account_id;
  END IF;
END $$;

-- user_creatives (from migration 059)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_creatives' AND column_name = 'ad_account_id') THEN
    ALTER TABLE user_creatives RENAME COLUMN ad_account_id TO account_id;
  END IF;
END $$;

-- generated_creatives (from migration 059)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'generated_creatives' AND column_name = 'ad_account_id') THEN
    ALTER TABLE generated_creatives RENAME COLUMN ad_account_id TO account_id;
  END IF;
END $$;

-- default_ad_settings (from migration 059)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'default_ad_settings' AND column_name = 'ad_account_id') THEN
    ALTER TABLE default_ad_settings RENAME COLUMN ad_account_id TO account_id;
  END IF;
END $$;

-- whatsapp_phone_numbers (from migration 058)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_phone_numbers' AND column_name = 'ad_account_id') THEN
    ALTER TABLE whatsapp_phone_numbers RENAME COLUMN ad_account_id TO account_id;
  END IF;
END $$;

-- user_briefing_responses (from migration 060)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_briefing_responses' AND column_name = 'ad_account_id') THEN
    ALTER TABLE user_briefing_responses RENAME COLUMN ad_account_id TO account_id;
  END IF;
END $$;

-- brain_executions (from migration 063)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brain_executions' AND column_name = 'ad_account_id') THEN
    ALTER TABLE brain_executions RENAME COLUMN ad_account_id TO account_id;
  END IF;
END $$;

-- campaign_reports (from migration 063)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_reports' AND column_name = 'ad_account_id') THEN
    ALTER TABLE campaign_reports RENAME COLUMN ad_account_id TO account_id;
  END IF;
END $$;

-- NOTE: creative_tests already uses account_id (added in migration 064 with correct name)

-- =====================================================
-- UPDATE INDEX NAMES (only if column exists)
-- =====================================================

-- Drop old indexes (safe - IF EXISTS)
DROP INDEX IF EXISTS idx_account_directions_ad_account_id;
DROP INDEX IF EXISTS idx_user_creatives_ad_account_id;
DROP INDEX IF EXISTS idx_generated_creatives_ad_account_id;
DROP INDEX IF EXISTS idx_default_ad_settings_ad_account_id;
DROP INDEX IF EXISTS idx_whatsapp_phone_numbers_ad_account_id;
DROP INDEX IF EXISTS idx_brain_executions_ad_account_id;
DROP INDEX IF EXISTS idx_campaign_reports_ad_account_id;
DROP INDEX IF EXISTS idx_user_briefing_unique_per_account;

-- Create new indexes only if column exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_directions' AND column_name = 'account_id') THEN
    CREATE INDEX IF NOT EXISTS idx_account_directions_account_id ON account_directions(account_id) WHERE account_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_creatives' AND column_name = 'account_id') THEN
    CREATE INDEX IF NOT EXISTS idx_user_creatives_account_id ON user_creatives(account_id) WHERE account_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'generated_creatives' AND column_name = 'account_id') THEN
    CREATE INDEX IF NOT EXISTS idx_generated_creatives_account_id ON generated_creatives(account_id) WHERE account_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'default_ad_settings' AND column_name = 'account_id') THEN
    CREATE INDEX IF NOT EXISTS idx_default_ad_settings_account_id ON default_ad_settings(account_id) WHERE account_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_phone_numbers' AND column_name = 'account_id') THEN
    CREATE INDEX IF NOT EXISTS idx_whatsapp_phone_numbers_account_id ON whatsapp_phone_numbers(account_id) WHERE account_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brain_executions' AND column_name = 'account_id') THEN
    CREATE INDEX IF NOT EXISTS idx_brain_executions_account_id ON brain_executions(account_id) WHERE account_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_reports' AND column_name = 'account_id') THEN
    CREATE INDEX IF NOT EXISTS idx_campaign_reports_account_id ON campaign_reports(account_id) WHERE account_id IS NOT NULL;
  END IF;
END $$;

-- NOTE: creative_tests index already has correct name from migration 064

-- user_briefing_responses has a composite unique index
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_briefing_responses' AND column_name = 'account_id') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_briefing_unique_per_account
    ON user_briefing_responses(user_id, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid));
  END IF;
END $$;

-- =====================================================
-- UPDATE COMMENTS (only if column exists)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_directions' AND column_name = 'account_id') THEN
    COMMENT ON COLUMN account_directions.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_creatives' AND column_name = 'account_id') THEN
    COMMENT ON COLUMN user_creatives.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'generated_creatives' AND column_name = 'account_id') THEN
    COMMENT ON COLUMN generated_creatives.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'default_ad_settings' AND column_name = 'account_id') THEN
    COMMENT ON COLUMN default_ad_settings.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_phone_numbers' AND column_name = 'account_id') THEN
    COMMENT ON COLUMN whatsapp_phone_numbers.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_briefing_responses' AND column_name = 'account_id') THEN
    COMMENT ON COLUMN user_briefing_responses.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brain_executions' AND column_name = 'account_id') THEN
    COMMENT ON COLUMN brain_executions.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_reports' AND column_name = 'account_id') THEN
    COMMENT ON COLUMN campaign_reports.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
END $$;
