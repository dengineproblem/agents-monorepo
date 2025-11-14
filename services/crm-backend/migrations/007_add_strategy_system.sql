-- Migration: Add strategy system for campaign message generation
-- Date: 2025-11-14
-- Description: Добавление системы стратегических типов сообщений и актуального контекста

-- ===== 1. Таблица campaign_contexts (актуальные контексты: акции, кейсы, новости) =====

CREATE TABLE IF NOT EXISTS campaign_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('promo', 'case', 'content', 'news')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  goal TEXT,
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  target_funnel_stages TEXT[],
  target_interest_levels TEXT[] CHECK (target_interest_levels <@ ARRAY['hot', 'warm', 'cold']),
  priority INT DEFAULT 1 CHECK (priority BETWEEN 1 AND 5),
  is_active BOOLEAN DEFAULT true,
  usage_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_contexts_user ON campaign_contexts(user_account_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contexts_active ON campaign_contexts(is_active, start_date, end_date) 
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_campaign_contexts_priority ON campaign_contexts(priority DESC);

COMMENT ON TABLE campaign_contexts IS 'Актуальные контексты для использования в рассылках (акции, кейсы, новости)';
COMMENT ON COLUMN campaign_contexts.type IS 'Тип контекста: promo (акция), case (кейс), content (полезный контент), news (новость)';
COMMENT ON COLUMN campaign_contexts.goal IS 'Цель использования этого контекста (опционально)';
COMMENT ON COLUMN campaign_contexts.target_funnel_stages IS 'Целевые этапы воронки для этого контекста (пусто = все)';
COMMENT ON COLUMN campaign_contexts.target_interest_levels IS 'Целевые уровни теплоты для этого контекста (пусто = все)';
COMMENT ON COLUMN campaign_contexts.priority IS 'Приоритет контекста (1-5, где 5 = самый высокий)';

-- ===== 2. Таблица campaign_strategy_overrides (переопределение матрицы стратегий) =====

CREATE TABLE IF NOT EXISTS campaign_strategy_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID UNIQUE NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  matrix_json JSONB NOT NULL,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_overrides_user ON campaign_strategy_overrides(user_account_id);

COMMENT ON TABLE campaign_strategy_overrides IS 'Переопределение дефолтной матрицы стратегий для конкретного пользователя';
COMMENT ON COLUMN campaign_strategy_overrides.matrix_json IS 'JSON с кастомной матрицей стратегий';

-- ===== 3. Расширение таблицы campaign_messages =====

-- Добавляем strategy_type и context_id к сообщениям
ALTER TABLE campaign_messages 
  ADD COLUMN IF NOT EXISTS strategy_type TEXT CHECK (strategy_type IN ('check_in', 'value', 'case', 'offer', 'direct_selling')),
  ADD COLUMN IF NOT EXISTS context_id UUID REFERENCES campaign_contexts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS goal_description TEXT;

CREATE INDEX IF NOT EXISTS idx_campaign_messages_strategy ON campaign_messages(strategy_type);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_context ON campaign_messages(context_id);

COMMENT ON COLUMN campaign_messages.strategy_type IS 'Стратегический тип сообщения: check_in, value, case, offer, direct_selling';
COMMENT ON COLUMN campaign_messages.context_id IS 'Ссылка на использованный актуальный контекст (если есть)';
COMMENT ON COLUMN campaign_messages.goal_description IS 'Цель этого конкретного сообщения';

-- ===== 4. Расширение таблицы campaign_templates =====

-- Добавляем strategy_type к шаблонам (опционально, для более точной фильтрации)
ALTER TABLE campaign_templates
  ADD COLUMN IF NOT EXISTS strategy_type TEXT CHECK (strategy_type IN ('check_in', 'value', 'case', 'offer', 'direct_selling'));

CREATE INDEX IF NOT EXISTS idx_campaign_templates_strategy ON campaign_templates(strategy_type);

COMMENT ON COLUMN campaign_templates.strategy_type IS 'Опциональный стратегический тип для более точной фильтрации шаблонов';

-- ===== 5. Комментарии для документации =====

COMMENT ON COLUMN campaign_messages.message_type IS 'Технический тип (selling/useful/reminder) - маппится из strategy_type';


