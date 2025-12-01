-- Migration 056: Add multi_account_enabled flag to user_accounts
-- This flag controls whether user uses multi-account mode or legacy mode
-- SAFE: Only adds new column with default value, no breaking changes

ALTER TABLE user_accounts
ADD COLUMN multi_account_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_accounts.multi_account_enabled IS
  'Включён ли режим мультиаккаунтности. false = legacy режим (данные из user_accounts), true = multi-account режим (данные из ad_accounts)';
