-- Migration 078: User Analytics System
-- Created: 2025-12-06
-- Description: Таблицы для полного логирования действий пользователей и скоринга

-- =====================================================
-- 1. Таблица событий пользователей (основная)
-- =====================================================
CREATE TABLE IF NOT EXISTS user_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Идентификация пользователя
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL,

  -- Событие
  event_category TEXT NOT NULL CHECK (event_category IN (
    'page_view', 'click', 'form', 'api_call', 'error', 'business'
  )),
  event_action TEXT NOT NULL,
  event_label TEXT,
  event_value NUMERIC,

  -- Контекст страницы
  page_path TEXT,
  component TEXT,

  -- API специфичные поля
  api_endpoint TEXT,
  api_method TEXT,
  api_status_code INTEGER,
  api_duration_ms INTEGER,

  -- Ошибки
  error_message TEXT,
  error_stack TEXT,

  -- Дополнительные метаданные
  metadata JSONB DEFAULT '{}',

  -- Информация об устройстве
  user_agent TEXT,
  device_type TEXT,

  -- Timestamps
  client_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_user_events_user_date ON user_events(user_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_session ON user_events(session_id);
CREATE INDEX IF NOT EXISTS idx_user_events_category ON user_events(event_category);
CREATE INDEX IF NOT EXISTS idx_user_events_page ON user_events(page_path);
CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events(created_at DESC);

-- Комментарии
COMMENT ON TABLE user_events IS 'Все события пользователей: page views, clicks, API calls, ошибки, бизнес-события';
COMMENT ON COLUMN user_events.event_category IS 'Категория: page_view, click, form, api_call, error, business';
COMMENT ON COLUMN user_events.session_id IS 'UUID сессии браузера (из sessionStorage)';
COMMENT ON COLUMN user_events.metadata IS 'Дополнительные данные события в JSON формате';

-- =====================================================
-- 2. Таблица сессий пользователей
-- =====================================================
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,

  -- Время сессии
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,

  -- Статистика сессии
  page_views INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,

  -- Навигация
  entry_page TEXT,
  exit_page TEXT,

  -- Устройство
  device_type TEXT,
  browser TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_updated ON user_sessions(updated_at DESC);

-- Комментарии
COMMENT ON TABLE user_sessions IS 'Сессии пользователей для отслеживания активности';
COMMENT ON COLUMN user_sessions.session_id IS 'Уникальный ID сессии из браузера';

-- =====================================================
-- 3. Таблица скоров пользователей (ежедневная агрегация)
-- =====================================================
CREATE TABLE IF NOT EXISTS user_engagement_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL,

  -- Период
  date DATE NOT NULL,

  -- Метрики активности
  total_sessions INTEGER DEFAULT 0,
  total_page_views INTEGER DEFAULT 0,
  total_clicks INTEGER DEFAULT 0,
  total_time_seconds INTEGER DEFAULT 0,
  api_calls_success INTEGER DEFAULT 0,
  api_calls_failure INTEGER DEFAULT 0,

  -- Бизнес метрики
  campaigns_created INTEGER DEFAULT 0,
  creatives_launched INTEGER DEFAULT 0,
  leads_received INTEGER DEFAULT 0,

  -- Скоры (0-100)
  engagement_score INTEGER CHECK (engagement_score >= 0 AND engagement_score <= 100),
  activity_score INTEGER CHECK (activity_score >= 0 AND activity_score <= 100),
  health_score INTEGER CHECK (health_score >= 0 AND health_score <= 100),
  overall_score INTEGER CHECK (overall_score >= 0 AND overall_score <= 100),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Уникальность: один скор на пользователя/аккаунт в день
  UNIQUE(user_account_id, account_id, date)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_user_scores_user_date ON user_engagement_scores(user_account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_user_scores_overall ON user_engagement_scores(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_scores_date ON user_engagement_scores(date DESC);

-- Комментарии
COMMENT ON TABLE user_engagement_scores IS 'Ежедневные скоры вовлечённости пользователей';
COMMENT ON COLUMN user_engagement_scores.engagement_score IS 'Engagement Score (0-100): page views, clicks, время на сайте';
COMMENT ON COLUMN user_engagement_scores.activity_score IS 'Activity Score (0-100): API calls, бизнес-действия';
COMMENT ON COLUMN user_engagement_scores.health_score IS 'Health Score (0-100): процент успешных операций';
COMMENT ON COLUMN user_engagement_scores.overall_score IS 'Overall Score: engagement*0.3 + activity*0.4 + health*0.3';
