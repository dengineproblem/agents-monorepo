-- Migration 123: Daily Breakdown Enhancement
--
-- Расширяет meta_insights_daily дополнительными полями для полного анализа по дням
-- Добавляет daily_breakdown JSONB в ad_weekly_anomalies для детализации аномалий
--
-- Цель: для каждой аномалии (неделя + объявление) показывать детализацию метрик по дням

-- ============================================================================
-- 1. Расширение meta_insights_daily
-- ============================================================================

-- Частота показов (вычисляется как impressions / reach)
ALTER TABLE meta_insights_daily
ADD COLUMN IF NOT EXISTS frequency DECIMAL(8,4);

-- Клики по ссылкам (из outbound_clicks или actions)
ALTER TABLE meta_insights_daily
ADD COLUMN IF NOT EXISTS link_clicks INTEGER DEFAULT 0;

-- Link CTR = link_clicks / impressions * 100
ALTER TABLE meta_insights_daily
ADD COLUMN IF NOT EXISTS link_ctr DECIMAL(8,6);

-- Сырые actions для анализа результатов по семействам
ALTER TABLE meta_insights_daily
ADD COLUMN IF NOT EXISTS actions_json JSONB;

-- ============================================================================
-- 2. Добавление daily_breakdown в ad_weekly_anomalies
-- ============================================================================

-- JSONB структура с детализацией метрик по дням недели аномалии
ALTER TABLE ad_weekly_anomalies
ADD COLUMN IF NOT EXISTS daily_breakdown JSONB;

-- ============================================================================
-- 3. Индексы
-- ============================================================================

-- GIN индекс для поиска по actions_json
CREATE INDEX IF NOT EXISTS idx_daily_insights_actions_gin
ON meta_insights_daily USING gin (actions_json);

-- ============================================================================
-- 4. Комментарии
-- ============================================================================

COMMENT ON COLUMN meta_insights_daily.frequency IS 'Частота показов = impressions / reach';
COMMENT ON COLUMN meta_insights_daily.link_clicks IS 'Клики по ссылкам из outbound_clicks или actions';
COMMENT ON COLUMN meta_insights_daily.link_ctr IS 'Link CTR = link_clicks / impressions * 100';
COMMENT ON COLUMN meta_insights_daily.actions_json IS 'Сырые actions для анализа результатов по семействам';
COMMENT ON COLUMN ad_weekly_anomalies.daily_breakdown IS 'Детализация метрик по дням недели аномалии (JSONB)';

-- ============================================================================
-- Структура daily_breakdown JSONB:
-- {
--   "days": [
--     {
--       "date": "2025-01-06",
--       "metrics": {
--         "impressions": 1500,
--         "spend": 25.50,
--         "frequency": 1.8,
--         "ctr": 2.1,
--         "link_ctr": 1.5,
--         "cpm": 17.00,
--         "cpr": 5.10,
--         "results": 5
--       },
--       "deviations": [
--         {"metric": "cpr", "value": 5.10, "week_avg": 4.20, "delta_pct": 21.4, "direction": "bad"}
--       ]
--     }
--   ],
--   "summary": {
--     "worst_day": "2025-01-08",
--     "best_day": "2025-01-06",
--     "active_days": 6,
--     "pause_days": 1
--   }
-- }
-- ============================================================================
