-- Migration: Rename ad_accounts columns to match user_accounts naming
-- Created: 2025-12-01
-- Description: Unify column names between user_accounts and ad_accounts for simpler code

-- =====================================================
-- RENAME FACEBOOK COLUMNS (to match user_accounts)
-- =====================================================
ALTER TABLE ad_accounts RENAME COLUMN fb_access_token TO access_token;
ALTER TABLE ad_accounts RENAME COLUMN fb_ad_account_id TO ad_account_id;
ALTER TABLE ad_accounts RENAME COLUMN fb_page_id TO page_id;
ALTER TABLE ad_accounts RENAME COLUMN fb_instagram_id TO instagram_id;
ALTER TABLE ad_accounts RENAME COLUMN fb_instagram_username TO instagram_username;
ALTER TABLE ad_accounts RENAME COLUMN fb_business_id TO business_id;

-- =====================================================
-- ADD MISSING COLUMNS (exist in user_accounts but not in ad_accounts)
-- =====================================================
-- WhatsApp phone number (user_accounts has it since migration 007)
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS whatsapp_phone_number TEXT;

-- =====================================================
-- COMMENTS FOR CLARITY
-- =====================================================
-- Facebook columns
COMMENT ON COLUMN ad_accounts.access_token IS 'Facebook access token (same as user_accounts.access_token)';
COMMENT ON COLUMN ad_accounts.ad_account_id IS 'Facebook Ad Account ID like act_123456 (same as user_accounts.ad_account_id)';
COMMENT ON COLUMN ad_accounts.page_id IS 'Facebook Page ID (same as user_accounts.page_id)';
COMMENT ON COLUMN ad_accounts.instagram_id IS 'Instagram Account ID (same as user_accounts.instagram_id)';
COMMENT ON COLUMN ad_accounts.instagram_username IS 'Instagram username (same as user_accounts.instagram_username)';
COMMENT ON COLUMN ad_accounts.business_id IS 'Facebook Business ID (same as user_accounts.business_id)';

-- WhatsApp
COMMENT ON COLUMN ad_accounts.whatsapp_phone_number IS 'WhatsApp phone number in international format (same as user_accounts.whatsapp_phone_number)';

-- =====================================================
-- VERIFICATION: Column alignment between tables
-- =====================================================
-- After this migration, ad_accounts columns match user_accounts:
--
-- FACEBOOK (renamed in this migration):
--   access_token ✓
--   ad_account_id ✓
--   page_id ✓
--   instagram_id ✓
--   instagram_username ✓
--   business_id ✓
--   ig_seed_audience_id ✓ (already matched)
--
-- WHATSAPP (added in this migration):
--   whatsapp_phone_number ✓
--
-- TIKTOK (already matched):
--   tiktok_account_id ✓
--   tiktok_business_id ✓
--   tiktok_access_token ✓
--
-- TELEGRAM (already matched):
--   telegram_id ✓
--   telegram_id_2 ✓
--   telegram_id_3 ✓
--   telegram_id_4 ✓
--
-- AMOCRM (already matched):
--   amocrm_subdomain ✓
--   amocrm_access_token ✓
--   amocrm_refresh_token ✓
--   amocrm_token_expires_at ✓
--   amocrm_client_id ✓
--   amocrm_client_secret ✓
--
-- AI/PROMPTS (already matched):
--   prompt1, prompt2, prompt3, prompt4 ✓
--   openai_api_key ✓
--   gemini_api_key ✓
--
-- TARIFF (already matched):
--   tarif ✓
--   tarif_expires ✓
--
-- CUSTOM AUDIENCES (already matched):
--   custom_audiences ✓
