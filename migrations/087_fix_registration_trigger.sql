-- Migration: 087_fix_registration_trigger.sql
-- Description: Исправление триггера регистрации - убрать email (колонки нет в user_accounts)
-- Created: 2024-12-09

-- Исправляем функцию: убираем NEW.email (колонка не существует)
CREATE OR REPLACE FUNCTION notify_admin_on_registration()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO admin_notifications (type, title, message, metadata)
  VALUES (
    'registration',
    'Новая регистрация: ' || COALESCE(NEW.username, NEW.telegram_id, 'пользователь'),
    'Пользователь зарегистрировался в системе',
    jsonb_build_object('userId', NEW.id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
