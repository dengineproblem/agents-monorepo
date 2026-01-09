-- Migration 141: Add account_id for multi-account support
-- Date: 2025-01-09
-- Description: Добавляем account_id для поддержки мультиаккаунтности в campaign_contexts, business_profile, scoring_executions
-- SAFE: Only adds nullable columns with optional FK

-- ============================================================
-- 1. campaign_contexts - добавить account_id
-- ============================================================
ALTER TABLE campaign_contexts
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES ad_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_campaign_contexts_account
  ON campaign_contexts(account_id)
  WHERE account_id IS NOT NULL;

COMMENT ON COLUMN campaign_contexts.account_id IS 'FK на ad_accounts для мультиаккаунтности (NULL = legacy режим)';

-- ============================================================
-- 2. business_profile - добавить account_id
-- ============================================================
ALTER TABLE business_profile
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES ad_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_business_profile_account
  ON business_profile(account_id)
  WHERE account_id IS NOT NULL;

COMMENT ON COLUMN business_profile.account_id IS 'FK на ad_accounts для мультиаккаунтности (NULL = legacy режим)';

-- ============================================================
-- 3. scoring_executions - добавить account_id
-- ============================================================
ALTER TABLE scoring_executions
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES ad_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_scoring_executions_account
  ON scoring_executions(account_id)
  WHERE account_id IS NOT NULL;

COMMENT ON COLUMN scoring_executions.account_id IS 'FK на ad_accounts для мультиаккаунтности (NULL = legacy режим)';
