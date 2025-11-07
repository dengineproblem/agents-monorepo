-- Migration: Add skip_whatsapp_number_in_api flag to user_accounts
-- Purpose: Enable workaround for Facebook API bug 2446885 (WhatsApp Business required)
-- Default: true (new behavior - don't send whatsapp_phone_number, let Facebook use page default)
-- When false: use old behavior (send whatsapp_phone_number with fallback logic)

ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS skip_whatsapp_number_in_api BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN user_accounts.skip_whatsapp_number_in_api IS
'Workaround для Facebook API bug 2446885.
true (default): НЕ отправлять whatsapp_phone_number в Facebook API, пусть FB сам подставляет дефолтный номер со страницы.
false: отправлять whatsapp_phone_number (старая логика с 4-tier fallback).
Для пользователей с проблемой 2446885 - оставить true.
Для пользователей, у которых работает старая логика - вручную установить false.';
