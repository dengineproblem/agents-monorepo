-- Migration 201: Add anthropic_api_key to ad_accounts and user_accounts
-- Allows per-account Anthropic API keys for NanoClaw Telegram bot

ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;

COMMENT ON COLUMN ad_accounts.anthropic_api_key IS 'Per-account Anthropic API key for Claude (Telegram bot). NULL = use system key.';
COMMENT ON COLUMN user_accounts.anthropic_api_key IS 'Per-user Anthropic API key for Claude (legacy mode). NULL = use system key.';
