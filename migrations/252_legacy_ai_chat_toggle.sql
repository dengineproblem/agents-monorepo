-- 252_legacy_ai_chat_toggle.sql
-- Добавляет флаг для отключения AI-ответов в Telegram per-юзер.
-- Когда true — Telegram-сообщения юзера НЕ обрабатываются AI, идут только в admin_user_chats для ручного ответа админа.

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS ai_disabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_accounts.ai_disabled IS
  'Если true — AI не отвечает на сообщения юзера в Telegram (legacy AI chat). Админ управляет через AdminChats UI.';
