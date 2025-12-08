-- Migration 084: Notification System for User Engagement
-- Created: 2025-12-08
-- Description: Система уведомлений для вовлечения пользователей + двусторонний чат через Telegram

-- =====================================================
-- 1. Таблица истории отправок уведомлений
-- =====================================================

CREATE TABLE IF NOT EXISTS notification_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Тип и канал
  notification_type VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL, -- 'telegram', 'in_app', 'both'

  -- Статус доставки
  telegram_sent BOOLEAN DEFAULT false,
  in_app_created BOOLEAN DEFAULT false,
  notification_id UUID REFERENCES user_notifications(id) ON DELETE SET NULL,

  -- Метаданные
  message_preview TEXT,
  metadata JSONB DEFAULT '{}',

  -- Время
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для проверки cooldown (последняя отправка по типу)
CREATE INDEX IF NOT EXISTS idx_notification_history_user_type
ON notification_history(user_account_id, notification_type, created_at DESC);

-- Индекс для подсчёта лимитов за период
CREATE INDEX IF NOT EXISTS idx_notification_history_user_date
ON notification_history(user_account_id, created_at DESC);

-- Индекс для статистики по типам
CREATE INDEX IF NOT EXISTS idx_notification_history_type
ON notification_history(notification_type, created_at DESC);

COMMENT ON TABLE notification_history IS 'История отправленных engagement уведомлений';
COMMENT ON COLUMN notification_history.notification_type IS 'Тип: inactive_3d, inactive_7d, onboarding_reminder, achievement_*';
COMMENT ON COLUMN notification_history.channel IS 'Каналы отправки: telegram, in_app, both';

-- =====================================================
-- 2. Таблица глобальных настроек уведомлений (singleton)
-- =====================================================

CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001',

  -- Глобальные лимиты
  daily_limit INTEGER DEFAULT 3 CHECK (daily_limit >= 0 AND daily_limit <= 10),
  weekly_limit INTEGER DEFAULT 10 CHECK (weekly_limit >= 0 AND weekly_limit <= 50),

  -- Час отправки (по UTC, для Алматы +6 = 10:00 местного)
  send_hour INTEGER DEFAULT 4 CHECK (send_hour >= 0 AND send_hour <= 23),

  -- Cooldown по типам (дни)
  type_cooldowns JSONB DEFAULT '{
    "inactive_3d": 3,
    "inactive_7d": 7,
    "inactive_14d": 14,
    "onboarding_reminder": 3,
    "achievement_first_lead": 9999,
    "achievement_5_creatives": 9999,
    "achievement_profitable_week": 7
  }'::jsonb,

  -- Включённые типы уведомлений
  enabled_types JSONB DEFAULT '[
    "inactive_3d",
    "inactive_7d",
    "inactive_14d",
    "onboarding_reminder",
    "achievement_first_lead",
    "achievement_5_creatives",
    "achievement_profitable_week"
  ]'::jsonb,

  -- Флаг активности системы
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Создаём singleton запись
INSERT INTO notification_settings (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE notification_settings IS 'Глобальные настройки системы engagement уведомлений (singleton)';
COMMENT ON COLUMN notification_settings.send_hour IS 'Час отправки в UTC. Для Алматы (UTC+6) ставить 4 = 10:00 местного';
COMMENT ON COLUMN notification_settings.type_cooldowns IS 'JSON: {"type_name": cooldown_days}. 9999 = только один раз';
COMMENT ON COLUMN notification_settings.enabled_types IS 'JSON array включённых типов уведомлений';

-- =====================================================
-- 3. Таблица сообщений чата админ-пользователь
-- =====================================================

CREATE TABLE IF NOT EXISTS admin_user_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Направление сообщения
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('to_user', 'from_user')),

  -- Контент
  message TEXT NOT NULL,

  -- Кто отправил (для to_user - админ, для from_user - null)
  admin_id UUID REFERENCES user_accounts(id) ON DELETE SET NULL,

  -- Telegram message_id (для возможной связи/ответа)
  telegram_message_id BIGINT,

  -- Статус доставки
  delivered BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для получения истории чата
CREATE INDEX IF NOT EXISTS idx_admin_user_chats_user
ON admin_user_chats(user_account_id, created_at DESC);

-- Индекс для непрочитанных сообщений от пользователей
CREATE INDEX IF NOT EXISTS idx_admin_user_chats_unread
ON admin_user_chats(user_account_id, direction, read_at)
WHERE direction = 'from_user' AND read_at IS NULL;

-- Индекс для подсчёта непрочитанных по всем пользователям (для бейджа в админке)
CREATE INDEX IF NOT EXISTS idx_admin_user_chats_all_unread
ON admin_user_chats(direction, read_at, created_at DESC)
WHERE direction = 'from_user' AND read_at IS NULL;

COMMENT ON TABLE admin_user_chats IS 'История сообщений между админами и пользователями через Telegram';
COMMENT ON COLUMN admin_user_chats.direction IS 'to_user = админ пишет пользователю, from_user = пользователь отвечает';
COMMENT ON COLUMN admin_user_chats.admin_id IS 'UUID админа, отправившего сообщение (только для to_user)';
COMMENT ON COLUMN admin_user_chats.telegram_message_id IS 'ID сообщения в Telegram для связи';

-- =====================================================
-- 4. RLS политики
-- =====================================================

ALTER TABLE notification_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_user_chats ENABLE ROW LEVEL SECURITY;

-- notification_history - только service_role
DROP POLICY IF EXISTS "Service role full access to notification_history" ON notification_history;
CREATE POLICY "Service role full access to notification_history"
ON notification_history
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- notification_settings - только service_role
DROP POLICY IF EXISTS "Service role full access to notification_settings" ON notification_settings;
CREATE POLICY "Service role full access to notification_settings"
ON notification_settings
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- admin_user_chats - только service_role
DROP POLICY IF EXISTS "Service role full access to admin_user_chats" ON admin_user_chats;
CREATE POLICY "Service role full access to admin_user_chats"
ON admin_user_chats
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- 5. Добавляем поле last_session_at в user_accounts для быстрого доступа
-- =====================================================

ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS last_session_at TIMESTAMPTZ;

COMMENT ON COLUMN user_accounts.last_session_at IS 'Время последней сессии пользователя (обновляется из user_sessions)';

-- Заполняем last_session_at из существующих данных
UPDATE user_accounts ua
SET last_session_at = (
  SELECT MAX(started_at)
  FROM user_sessions us
  WHERE us.user_account_id = ua.id
)
WHERE last_session_at IS NULL;

-- =====================================================
-- 6. Триггер для автообновления last_session_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_user_last_session()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_accounts
  SET last_session_at = NEW.started_at
  WHERE id = NEW.user_account_id
    AND (last_session_at IS NULL OR last_session_at < NEW.started_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_last_session ON user_sessions;
CREATE TRIGGER trg_update_last_session
AFTER INSERT ON user_sessions
FOR EACH ROW
EXECUTE FUNCTION update_user_last_session();

COMMENT ON FUNCTION update_user_last_session() IS 'Автоматически обновляет last_session_at в user_accounts при новой сессии';
