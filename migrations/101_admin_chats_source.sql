-- Migration: Add source and telegram_id fields to admin_user_chats
-- Для различения типов сообщений и хранения истории онбординга

-- 1. Добавляем поле source
ALTER TABLE admin_user_chats
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'admin';

-- 2. Добавляем telegram_id для хранения сообщений до регистрации (онбординг)
ALTER TABLE admin_user_chats
ADD COLUMN IF NOT EXISTS telegram_id TEXT;

-- 3. Делаем user_account_id nullable (для онбординга когда юзера ещё нет)
ALTER TABLE admin_user_chats
ALTER COLUMN user_account_id DROP NOT NULL;

-- 4. Добавляем constraint: должен быть либо user_account_id, либо telegram_id
ALTER TABLE admin_user_chats
ADD CONSTRAINT chk_user_or_telegram
CHECK (user_account_id IS NOT NULL OR telegram_id IS NOT NULL);

-- Комментарии
COMMENT ON COLUMN admin_user_chats.source IS 'Источник сообщения: admin, bot, onboarding, broadcast, external';
COMMENT ON COLUMN admin_user_chats.telegram_id IS 'Telegram chat ID (для сообщений до регистрации)';

-- Индексы
CREATE INDEX IF NOT EXISTS idx_admin_user_chats_source ON admin_user_chats(source);
CREATE INDEX IF NOT EXISTS idx_admin_user_chats_telegram_id ON admin_user_chats(telegram_id) WHERE telegram_id IS NOT NULL;

-- 5. Функция для связывания сообщений после регистрации
CREATE OR REPLACE FUNCTION link_onboarding_messages_to_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Когда пользователь регистрируется, связываем его сообщения из онбординга
  IF NEW.telegram_id IS NOT NULL THEN
    UPDATE admin_user_chats
    SET user_account_id = NEW.id
    WHERE telegram_id = NEW.telegram_id
      AND user_account_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер: при создании user_account связать сообщения
DROP TRIGGER IF EXISTS trg_link_onboarding_messages ON user_accounts;
CREATE TRIGGER trg_link_onboarding_messages
  AFTER INSERT ON user_accounts
  FOR EACH ROW
  EXECUTE FUNCTION link_onboarding_messages_to_user();
