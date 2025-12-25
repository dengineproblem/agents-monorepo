-- Migration 113: CPR Preceding Deviations
-- Система анализа предшествующих отклонений для CPR аномалий
--
-- Добавляет:
-- 1. Новые лаги для CPM, Spend, Link CTR в ad_weekly_features
-- 2. Baseline значения для новых метрик
-- 3. Поле preceding_deviations в ad_weekly_anomalies
-- 4. Колонку link_ctr в meta_insights_weekly

-- ============================================================================
-- 1. Расширение ad_weekly_features новыми лагами и baseline
-- ============================================================================

-- CPM лаги
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS cpm_lag1 DECIMAL(10,4);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS cpm_lag2 DECIMAL(10,4);

-- Spend лаги
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS spend_lag1 DECIMAL(12,2);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS spend_lag2 DECIMAL(12,2);

-- Link CTR (CTR по ссылкам, отдельно от общего CTR)
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS link_ctr DECIMAL(8,6);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS link_ctr_lag1 DECIMAL(8,6);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS link_ctr_lag2 DECIMAL(8,6);

-- Baseline значения для новых метрик
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_cpm DECIMAL(10,4);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_spend DECIMAL(12,2);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_link_ctr DECIMAL(8,6);

-- Дельты для новых метрик
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS cpm_delta_pct DECIMAL(8,4);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS spend_delta_pct DECIMAL(8,4);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS link_ctr_delta_pct DECIMAL(8,4);

-- ============================================================================
-- 2. Добавление preceding_deviations в ad_weekly_anomalies
-- ============================================================================

-- JSONB поле для хранения предшествующих отклонений
-- Структура:
-- {
--   "week_minus_1": {
--     "week_start": "2025-12-09",
--     "week_end": "2025-12-15",
--     "deviations": [
--       {"metric": "frequency", "value": 4.2, "baseline": 2.8, "delta_pct": 50.0, "is_significant": true, "direction": "bad"}
--     ]
--   },
--   "week_minus_2": { ... }
-- }
ALTER TABLE ad_weekly_anomalies ADD COLUMN IF NOT EXISTS preceding_deviations JSONB;

-- ============================================================================
-- 3. Добавление link_ctr в meta_insights_weekly
-- ============================================================================

-- CTR по ссылкам (link_clicks / impressions)
ALTER TABLE meta_insights_weekly ADD COLUMN IF NOT EXISTS link_ctr DECIMAL(8,6);

-- ============================================================================
-- 4. Индексы для оптимизации запросов
-- ============================================================================

-- Индекс для поиска аномалий с предшествующими отклонениями
CREATE INDEX IF NOT EXISTS idx_anomalies_preceding_deviations
ON ad_weekly_anomalies USING gin (preceding_deviations)
WHERE preceding_deviations IS NOT NULL;

-- Комментарии
COMMENT ON COLUMN ad_weekly_features.link_ctr IS 'CTR по ссылкам = link_clicks / impressions';
COMMENT ON COLUMN ad_weekly_anomalies.preceding_deviations IS 'Отклонения метрик за 1-2 недели до аномалии CPR';
COMMENT ON COLUMN meta_insights_weekly.link_ctr IS 'Click-through rate по ссылкам = link_clicks / impressions';
