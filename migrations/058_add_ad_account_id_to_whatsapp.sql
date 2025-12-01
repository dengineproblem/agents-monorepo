-- Migration 058: Add ad_account_id to whatsapp_phone_numbers
-- Links WhatsApp numbers to specific advertising accounts
-- SAFE: Only adds nullable column, no breaking changes

ALTER TABLE whatsapp_phone_numbers
ADD COLUMN ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE CASCADE;

-- Index for efficient lookup
CREATE INDEX idx_whatsapp_phone_numbers_ad_account_id
  ON whatsapp_phone_numbers(ad_account_id);

COMMENT ON COLUMN whatsapp_phone_numbers.ad_account_id IS
  'Привязка WhatsApp номера к конкретному рекламному аккаунту (для мультиаккаунтности). NULL = legacy режим.';
