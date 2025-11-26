-- Migration: Creative Analysis Table
-- Created: 2025-11-20
-- Purpose: Единая таблица для хранения LLM-анализов креативов из всех источников

-- =====================================================
-- 1. CREATE TABLE creative_analysis
-- =====================================================

CREATE TABLE IF NOT EXISTS creative_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID NOT NULL REFERENCES user_creatives(id) ON DELETE CASCADE,
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Источник анализа
  source TEXT NOT NULL CHECK (source IN ('test', 'manual', 'scheduled')),
  test_id UUID REFERENCES creative_tests(id),  -- Если из теста
  
  -- Период метрик
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  
  -- Агрегированные метрики (snapshot)
  metrics JSONB NOT NULL,
  
  -- LLM Анализ
  score INTEGER CHECK (score >= 0 AND score <= 100),
  verdict TEXT CHECK (verdict IN ('excellent', 'good', 'average', 'poor')),
  reasoning TEXT,
  video_analysis TEXT,
  text_recommendations TEXT,
  transcript_match_quality TEXT CHECK (transcript_match_quality IN ('high', 'medium', 'low')),
  transcript_suggestions JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. INDEXES
-- =====================================================

CREATE INDEX idx_creative_analysis_creative ON creative_analysis(creative_id, created_at DESC);
CREATE INDEX idx_creative_analysis_user ON creative_analysis(user_account_id, created_at DESC);
CREATE INDEX idx_creative_analysis_source ON creative_analysis(source, created_at DESC);
CREATE INDEX idx_creative_analysis_test ON creative_analysis(test_id) WHERE test_id IS NOT NULL;

-- =====================================================
-- 3. ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE creative_analysis ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own analyses
CREATE POLICY "Users can view own creative analyses"
  ON creative_analysis FOR SELECT
  USING (auth.uid() = user_account_id);

-- Policy: Service role has full access
CREATE POLICY "Service role has full access to creative analyses"
  ON creative_analysis
  USING (auth.role() = 'service_role');

-- =====================================================
-- 4. COMMENTS
-- =====================================================

COMMENT ON TABLE creative_analysis IS 
'Единая таблица для хранения LLM-анализов креативов из всех источников (тесты, ручной запуск, крон)';

COMMENT ON COLUMN creative_analysis.source IS 
'Источник анализа: test - из creative_tests, manual - ручной запуск, scheduled - по крону';

COMMENT ON COLUMN creative_analysis.metrics IS 
'Snapshot агрегированных метрик на момент анализа (JSON с impressions, clicks, leads, etc.)';

COMMENT ON COLUMN creative_analysis.verdict IS 
'Вердикт LLM: excellent (80-100), good (60-79), average (40-59), poor (0-39)';

COMMENT ON COLUMN creative_analysis.transcript_suggestions IS 
'JSON с предложениями по изменению текста: [{"from": "старый текст", "to": "новый текст", "reason": "..."}]';

-- =====================================================
-- USAGE EXAMPLES
-- =====================================================

-- Пример 1: Получить последний анализ креатива
-- SELECT * FROM creative_analysis 
-- WHERE creative_id = 'xxx' 
-- ORDER BY created_at DESC 
-- LIMIT 1;

-- Пример 2: Получить все ручные анализы пользователя
-- SELECT * FROM creative_analysis 
-- WHERE user_account_id = 'xxx' AND source = 'manual'
-- ORDER BY created_at DESC;

-- Пример 3: Сравнить результаты тестов vs production
-- SELECT 
--   source,
--   AVG(score) as avg_score,
--   COUNT(*) as total_analyses
-- FROM creative_analysis
-- WHERE creative_id = 'xxx'
-- GROUP BY source;



