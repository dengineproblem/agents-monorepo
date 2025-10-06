-- Migration: Creative Tests (Быстрое тестирование креативов)
-- Created: 2025-10-06
-- Description: Система для быстрого A/B тестирования креативов на 1000 показов

-- =====================================================
-- TABLE: creative_tests
-- =====================================================
CREATE TABLE IF NOT EXISTS creative_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_creative_id UUID NOT NULL REFERENCES user_creatives(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,  -- Денормализация для RLS, заполняется из user_creatives.user_id
  
  -- Facebook Campaign/AdSet/Ad IDs
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  rule_id TEXT,  -- Facebook Auto Rule ID
  
  -- Test Configuration
  test_budget_cents INTEGER DEFAULT 2000,  -- $20
  test_impressions_limit INTEGER DEFAULT 1000,
  objective TEXT DEFAULT 'WhatsApp',
  
  -- Test Status
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed', 'cancelled'
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- === RAW METRICS FROM FACEBOOK ===
  
  -- Basic Metrics
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  frequency NUMERIC(10,2),
  
  -- Clicks
  clicks INTEGER DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  ctr NUMERIC(10,4),  -- Click-through rate (%)
  link_ctr NUMERIC(10,4),  -- Link CTR (%)
  
  -- Leads
  leads INTEGER DEFAULT 0,
  
  -- Costs
  spend_cents INTEGER DEFAULT 0,
  cpm_cents INTEGER,  -- Cost per 1000 impressions
  cpc_cents INTEGER,  -- Cost per click
  cpl_cents INTEGER,  -- Cost per lead
  
  -- Video Metrics (если применимо)
  video_views INTEGER DEFAULT 0,
  video_views_25_percent INTEGER DEFAULT 0,
  video_views_50_percent INTEGER DEFAULT 0,
  video_views_75_percent INTEGER DEFAULT 0,
  video_views_95_percent INTEGER DEFAULT 0,
  video_avg_watch_time_sec NUMERIC(10,2),
  
  -- === LLM ANALYSIS ===
  
  -- Overall Assessment
  llm_score INTEGER,  -- 0-100
  llm_verdict TEXT,  -- 'excellent' (80-100), 'good' (60-79), 'average' (40-59), 'poor' (0-39)
  
  -- Detailed Analysis
  llm_reasoning TEXT,  -- Общий анализ результатов
  llm_video_analysis TEXT,  -- Анализ просмотров видео
  llm_text_recommendations TEXT,  -- Рекомендации по тексту видео (на основе транскрибации)
  
  -- Comparison with transcript
  transcript_match_quality TEXT,  -- 'high', 'medium', 'low'
  transcript_suggestions JSONB,  -- Конкретные предложения по изменению текста
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_creative_id)  -- Один креатив = один тест
);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_creative_tests_user_id ON creative_tests(user_id);
CREATE INDEX idx_creative_tests_user_creative_id ON creative_tests(user_creative_id);
CREATE INDEX idx_creative_tests_status ON creative_tests(status);
CREATE INDEX idx_creative_tests_started_at ON creative_tests(started_at);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE creative_tests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own tests
CREATE POLICY "Users can view own creative tests"
  ON creative_tests FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Service role can do everything
CREATE POLICY "Service role has full access to creative tests"
  ON creative_tests
  USING (auth.role() = 'service_role');

-- =====================================================
-- TRIGGER: Updated timestamp
-- =====================================================
CREATE TRIGGER update_creative_tests_updated_at
  BEFORE UPDATE ON creative_tests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE creative_tests IS 'Быстрое тестирование креативов на 1000 показов с LLM анализом';
COMMENT ON COLUMN creative_tests.status IS 'pending: создан, running: тест идет, completed: завершен, failed: ошибка, cancelled: отменен';
COMMENT ON COLUMN creative_tests.llm_verdict IS 'excellent: 80-100, good: 60-79, average: 40-59, poor: 0-39';
COMMENT ON COLUMN creative_tests.transcript_suggestions IS 'JSON с предложениями по изменению текста: [{"from": "старый текст", "to": "новый текст", "reason": "..."}]';
