-- Migration 118: Add all missing baseline columns to ad_weekly_features
-- Добавляет все baseline колонки для метрик

-- Базовые метрики
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_frequency DECIMAL(10,4);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_ctr DECIMAL(10,6);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_cpc DECIMAL(10,4);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_cpm DECIMAL(10,4);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_spend DECIMAL(12,2);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_link_ctr DECIMAL(10,6);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_results DECIMAL(10,2);

COMMENT ON COLUMN ad_weekly_features.baseline_frequency IS 'Baseline frequency (медиана за 8 недель)';
COMMENT ON COLUMN ad_weekly_features.baseline_ctr IS 'Baseline CTR (медиана за 8 недель)';
COMMENT ON COLUMN ad_weekly_features.baseline_cpc IS 'Baseline CPC (медиана за 8 недель)';
COMMENT ON COLUMN ad_weekly_features.baseline_cpm IS 'Baseline CPM (медиана за 8 недель)';
COMMENT ON COLUMN ad_weekly_features.baseline_spend IS 'Baseline spend (медиана за 8 недель)';
COMMENT ON COLUMN ad_weekly_features.baseline_link_ctr IS 'Baseline Link CTR (медиана за 8 недель)';
COMMENT ON COLUMN ad_weekly_features.baseline_results IS 'Baseline results count (медиана за 8 недель)';
