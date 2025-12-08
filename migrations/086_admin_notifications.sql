-- Migration: 086_admin_notifications.sql
-- Description: Таблица уведомлений для админ-панели
-- Created: 2024-12-08
-- Docs: docs/ADMIN_PANEL.md

CREATE TABLE IF NOT EXISTS admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL, -- 'message', 'registration', 'system', 'error'
  title VARCHAR(200) NOT NULL,
  message TEXT,
  metadata JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread ON admin_notifications(is_read, created_at DESC) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_admin_notifications_type ON admin_notifications(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created ON admin_notifications(created_at DESC);

-- Комментарии
COMMENT ON TABLE admin_notifications IS 'Уведомления для админ-панели';
COMMENT ON COLUMN admin_notifications.type IS 'Тип: message, registration, system, error';
COMMENT ON COLUMN admin_notifications.metadata IS 'Дополнительные данные: userId, errorId, link';

-- Триггер: уведомление при новом сообщении от пользователя
CREATE OR REPLACE FUNCTION notify_admin_on_user_message()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.direction = 'from_user' THEN
    INSERT INTO admin_notifications (type, title, message, metadata)
    SELECT
      'message',
      'Новое сообщение от ' || COALESCE(u.username, 'пользователя'),
      LEFT(NEW.message, 100),
      jsonb_build_object('userId', NEW.user_account_id, 'messageId', NEW.id)
    FROM user_accounts u
    WHERE u.id = NEW.user_account_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_admin_on_user_message ON admin_user_chats;
CREATE TRIGGER trigger_notify_admin_on_user_message
  AFTER INSERT ON admin_user_chats
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_on_user_message();

-- Триггер: уведомление при новой регистрации
CREATE OR REPLACE FUNCTION notify_admin_on_registration()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO admin_notifications (type, title, message, metadata)
  VALUES (
    'registration',
    'Новая регистрация: ' || COALESCE(NEW.username, NEW.email, 'пользователь'),
    'Пользователь зарегистрировался в системе',
    jsonb_build_object('userId', NEW.id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_admin_on_registration ON user_accounts;
CREATE TRIGGER trigger_notify_admin_on_registration
  AFTER INSERT ON user_accounts
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_on_registration();
