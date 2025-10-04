-- Migration: Scoring Agent Tables (SIMPLIFIED)
-- Описание: Создание таблиц для агента скоринга и предикшена
-- Дата: 2025-10-04
-- 
-- PHILOSOPHY:
-- - Метрики всегда дергаются из FB API напрямую (свежие данные)
-- - Таблицы нужны только для аудита и логирования результатов

-- =====================================================
-- 1. Таблица истории метрик (для АУДИТА)
-- =====================================================
CREATE TABLE IF NOT EXISTS creative_metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  -- Идентификаторы Facebook
  ad_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,
  creative_id TEXT, -- fb_creative_id
  
  -- Основные метрики (snapshot на момент запуска scoring agent)
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  spend DECIMAL(10,2) DEFAULT 0,
  ctr DECIMAL(5,2),
  cpm DECIMAL(10,2),
  frequency DECIMAL(5,2),
  
  -- Diagnostics rankings (на момент запуска)
  quality_ranking TEXT CHECK (quality_ranking IN ('above_average', 'average', 'below_average_35', 'below_average_20', 'below_average_10', NULL)),
  engagement_rate_ranking TEXT CHECK (engagement_rate_ranking IN ('above_average', 'average', 'below_average_35', 'below_average_20', 'below_average_10', NULL)),
  conversion_rate_ranking TEXT CHECK (conversion_rate_ranking IN ('above_average', 'average', 'below_average_35', 'below_average_20', 'below_average_10', NULL)),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes для быстрого поиска
CREATE INDEX idx_creative_metrics_user_date ON creative_metrics_history(user_account_id, date DESC);
CREATE INDEX idx_creative_metrics_adset ON creative_metrics_history(adset_id, date DESC) WHERE adset_id IS NOT NULL;
CREATE INDEX idx_creative_metrics_creative ON creative_metrics_history(creative_id, date DESC) WHERE creative_id IS NOT NULL;

-- UNIQUE constraint для предотвращения дублирования
CREATE UNIQUE INDEX creative_metrics_adset_unique ON creative_metrics_history(user_account_id, adset_id, date) WHERE adset_id IS NOT NULL;

COMMENT ON TABLE creative_metrics_history IS 'Snapshot метрик на момент запуска scoring agent (только для аудита и отладки)';

-- =====================================================
-- 2. Таблица истории запусков scoring agent
-- =====================================================
CREATE TABLE IF NOT EXISTS scoring_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'partial')),
  error_message TEXT,
  
  -- Статистика
  items_analyzed INTEGER DEFAULT 0, -- количество adsets
  creatives_analyzed INTEGER DEFAULT 0, -- количество креативов
  high_risk_count INTEGER DEFAULT 0,
  medium_risk_count INTEGER DEFAULT 0,
  low_risk_count INTEGER DEFAULT 0,
  
  -- Полный output от scoring LLM (весь JSON ответ)
  scoring_output JSONB,
  
  -- LLM stats
  llm_used BOOLEAN DEFAULT TRUE,
  llm_model TEXT,
  llm_tokens_used INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scoring_exec_user ON scoring_executions(user_account_id, created_at DESC);
CREATE INDEX idx_scoring_exec_status ON scoring_executions(status, created_at DESC);

COMMENT ON TABLE scoring_executions IS 'История запусков scoring agent - для мониторинга, отладки и аналитики';

-- =====================================================
-- 3. Таблица текущих скоров (для быстрого доступа)
-- =====================================================
CREATE TABLE IF NOT EXISTS creative_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Уровень (creative/adset)
  level TEXT NOT NULL CHECK (level IN ('creative', 'adset')),
  
  -- Идентификаторы
  creative_id TEXT, -- fb_creative_id
  adset_id TEXT,
  campaign_id TEXT,
  
  name TEXT,
  
  -- Скоринг (результат от LLM)
  date DATE NOT NULL,
  risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('Low', 'Medium', 'High')),
  
  -- Предикшн (от LLM)
  prediction_trend TEXT CHECK (prediction_trend IN ('improving', 'stable', 'declining', NULL)),
  prediction_cpl_current DECIMAL(10,2),
  prediction_cpl_expected DECIMAL(10,2),
  prediction_change_pct DECIMAL(5,1),
  
  -- Рекомендации от LLM
  recommendations JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_creative_scores_user_level ON creative_scores(user_account_id, level, date DESC);
CREATE INDEX idx_creative_scores_risk ON creative_scores(risk_level, date DESC);
CREATE INDEX idx_creative_scores_adset ON creative_scores(adset_id, date DESC) WHERE adset_id IS NOT NULL;
CREATE INDEX idx_creative_scores_creative ON creative_scores(creative_id, date DESC) WHERE creative_id IS NOT NULL;

-- UNIQUE constraints (один score на объект в день)
CREATE UNIQUE INDEX creative_scores_adset_unique ON creative_scores(user_account_id, adset_id, date) WHERE level = 'adset' AND adset_id IS NOT NULL;
CREATE UNIQUE INDEX creative_scores_creative_unique ON creative_scores(user_account_id, creative_id, date) WHERE level = 'creative' AND creative_id IS NOT NULL;

COMMENT ON TABLE creative_scores IS 'Текущие скоры от scoring agent - для быстрого доступа и UI';

-- =====================================================
-- Grant permissions (если нужно)
-- =====================================================
-- GRANT ALL ON creative_metrics_history TO service_role;
-- GRANT ALL ON scoring_executions TO service_role;
-- GRANT ALL ON creative_scores TO service_role;
