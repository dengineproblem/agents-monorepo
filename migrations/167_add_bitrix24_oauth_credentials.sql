-- Add Bitrix24 OAuth credentials to database
-- Allows each client to use their own Bitrix24 OAuth application

-- For legacy mode (user_accounts table)
ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_client_id TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_client_secret TEXT;

-- For multi-account mode (ad_accounts table)
ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_client_id TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_client_secret TEXT;

COMMENT ON COLUMN user_accounts.bitrix24_client_id IS 'Bitrix24 OAuth Application Client ID';
COMMENT ON COLUMN user_accounts.bitrix24_client_secret IS 'Bitrix24 OAuth Application Client Secret';
COMMENT ON COLUMN ad_accounts.bitrix24_client_id IS 'Bitrix24 OAuth Application Client ID (multi-account mode)';
COMMENT ON COLUMN ad_accounts.bitrix24_client_secret IS 'Bitrix24 OAuth Application Client Secret (multi-account mode)';
