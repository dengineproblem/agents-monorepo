-- Migration: 088_telegram_onboarding_sessions.sql
-- Description: Таблица для хранения состояния онбординга через Telegram бота
-- Created: 2024-12-09

-- Таблица сессий онбординга через Telegram
CREATE TABLE telegram_onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id TEXT NOT NULL UNIQUE,

  -- Прогресс онбординга (0 = приветствие, 1-15 = шаги вопросов, 16 = завершено)
  current_step INTEGER DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,

  -- Ответы пользователя (JSONB для гибкости)
  answers JSONB DEFAULT '{}',

  -- Связь с созданным user_account после завершения
  user_account_id UUID REFERENCES user_accounts(id),

  -- Метаданные из Telegram
  first_name TEXT,
  last_name TEXT,
  tg_username TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Индексы
CREATE INDEX idx_tg_onboarding_telegram_id ON telegram_onboarding_sessions(telegram_id);
CREATE INDEX idx_tg_onboarding_not_completed ON telegram_onboarding_sessions(is_completed) WHERE NOT is_completed;
CREATE INDEX idx_tg_onboarding_user_account ON telegram_onboarding_sessions(user_account_id) WHERE user_account_id IS NOT NULL;

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION update_telegram_onboarding_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_telegram_onboarding_updated_at
  BEFORE UPDATE ON telegram_onboarding_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_telegram_onboarding_updated_at();

-- RLS политики (доступ только для service_role)
ALTER TABLE telegram_onboarding_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to telegram_onboarding_sessions"
  ON telegram_onboarding_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE telegram_onboarding_sessions IS 'Сессии онбординга пользователей через Telegram бота';
COMMENT ON COLUMN telegram_onboarding_sessions.current_step IS '0=приветствие, 1-15=вопросы, 16=завершено';
COMMENT ON COLUMN telegram_onboarding_sessions.answers IS 'JSONB с ответами: {business_name, business_niche, ...}';
