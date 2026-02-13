-- Add WABA App Secret field to whatsapp_phone_numbers
-- Used for webhook signature verification (X-Hub-Signature-256)
ALTER TABLE whatsapp_phone_numbers
ADD COLUMN IF NOT EXISTS waba_app_secret TEXT;

COMMENT ON COLUMN whatsapp_phone_numbers.waba_app_secret IS 'Meta App Secret for WABA webhook signature verification (HMAC-SHA256)';
