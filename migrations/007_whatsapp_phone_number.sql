ALTER TABLE user_accounts 
ADD COLUMN IF NOT EXISTS whatsapp_phone_number TEXT;

COMMENT ON COLUMN user_accounts.whatsapp_phone_number IS 
'Опциональный номер WhatsApp (+1234567890). Если NULL - Facebook использует дефолтный.';
