-- 253_legacy_ai_chat_disable_by_default.sql
-- Отключаем AI-ответы по умолчанию для ВСЕХ пользователей (legacy AI chat).
-- Админы будут включать AI вручную через AdminChats UI на тех юзерах, где это нужно.

-- 1. Отключаем у всех существующих
UPDATE user_accounts
SET ai_disabled = true
WHERE ai_disabled = false;

-- 2. Меняем дефолт для новых пользователей
ALTER TABLE user_accounts
  ALTER COLUMN ai_disabled SET DEFAULT true;

COMMENT ON COLUMN user_accounts.ai_disabled IS
  'Если true — AI не отвечает на сообщения юзера в Telegram (legacy AI chat). По умолчанию выключено для всех; админ включает вручную через AdminChats UI.';
