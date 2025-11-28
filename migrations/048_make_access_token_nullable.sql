-- Migration: Make Facebook-related fields nullable for new onboarding flow
-- Now users can be created with just username/password, and connect Facebook later

-- access_token - заполняется после OAuth подключения Facebook
ALTER TABLE user_accounts
ALTER COLUMN access_token DROP NOT NULL;

-- ad_account_id - выбирается после подключения Facebook
ALTER TABLE user_accounts
ALTER COLUMN ad_account_id DROP NOT NULL;

-- page_id - выбирается после подключения Facebook
ALTER TABLE user_accounts
ALTER COLUMN page_id DROP NOT NULL;

COMMENT ON COLUMN user_accounts.access_token IS 'Facebook access token - nullable, filled after Facebook connection';
COMMENT ON COLUMN user_accounts.ad_account_id IS 'Facebook Ad Account ID - nullable, selected after Facebook connection';
COMMENT ON COLUMN user_accounts.page_id IS 'Facebook Page ID - nullable, selected after Facebook connection';
