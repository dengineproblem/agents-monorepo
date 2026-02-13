-- Migration 210: Add WABA access token to whatsapp_phone_numbers
-- Отдельный токен для WABA (System User Token), приоритет над ad_accounts/user_accounts.access_token

ALTER TABLE whatsapp_phone_numbers
ADD COLUMN IF NOT EXISTS waba_access_token TEXT;

COMMENT ON COLUMN whatsapp_phone_numbers.waba_access_token IS 'WABA System User Token (приоритет при отправке через Meta Cloud API)';
