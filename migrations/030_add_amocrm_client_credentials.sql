-- Migration 030: Add client_id and client_secret to user_accounts for auto-created AmoCRM integrations
-- Description: Store unique client credentials for each auto-created AmoCRM integration
-- Date: 2025-11-06

-- ============================================================================
-- Add AmoCRM client credentials to user_accounts
-- ============================================================================

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS amocrm_client_id TEXT,
  ADD COLUMN IF NOT EXISTS amocrm_client_secret TEXT;

COMMENT ON COLUMN user_accounts.amocrm_client_id IS 'AmoCRM integration client_id (unique for each auto-created integration)';
COMMENT ON COLUMN user_accounts.amocrm_client_secret IS 'AmoCRM integration client_secret (unique for each auto-created integration)';

-- Note: These fields are populated during OAuth callback for auto-created integrations
-- They are required for token refresh operations



