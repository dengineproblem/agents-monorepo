-- Migration 114: Ranking Score Deviations
-- Добавляет лаги для Ad Relevance Diagnostics (качество креатива)
--
-- Facebook Ad Relevance Diagnostics:
-- - quality_ranking - качество креатива
-- - engagement_rate_ranking - вовлечённость
-- - conversion_rate_ranking - конверсионность
--
-- Значения: 5 (ABOVE_AVERAGE), 3 (AVERAGE), 1-2 (BELOW_AVERAGE_10/20/35)

-- ============================================================================
-- 1. Добавление лагов для ranking scores в ad_weekly_features
-- ============================================================================

-- Quality ranking лаги
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS quality_rank_lag1 DECIMAL(3,1);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS quality_rank_lag2 DECIMAL(3,1);

-- Engagement ranking лаги
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS engagement_rank_lag1 DECIMAL(3,1);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS engagement_rank_lag2 DECIMAL(3,1);

-- Conversion ranking лаги
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS conversion_rank_lag1 DECIMAL(3,1);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS conversion_rank_lag2 DECIMAL(3,1);

-- ============================================================================
-- 2. Комментарии
-- ============================================================================

COMMENT ON COLUMN ad_weekly_features.quality_rank_lag1 IS 'Quality ranking за неделю t-1 (5=above, 3=avg, 1-2=below)';
COMMENT ON COLUMN ad_weekly_features.quality_rank_lag2 IS 'Quality ranking за неделю t-2';
COMMENT ON COLUMN ad_weekly_features.engagement_rank_lag1 IS 'Engagement ranking за неделю t-1';
COMMENT ON COLUMN ad_weekly_features.engagement_rank_lag2 IS 'Engagement ranking за неделю t-2';
COMMENT ON COLUMN ad_weekly_features.conversion_rank_lag1 IS 'Conversion ranking за неделю t-1';
COMMENT ON COLUMN ad_weekly_features.conversion_rank_lag2 IS 'Conversion ranking за неделю t-2';
