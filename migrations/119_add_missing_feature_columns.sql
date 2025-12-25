-- Migration 119: Add missing columns to ad_weekly_features
-- Добавляет недостающие колонки для полного набора features

-- Results delta
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS results_delta_pct DECIMAL(10,4);
COMMENT ON COLUMN ad_weekly_features.results_delta_pct IS 'Results delta percentage vs baseline';

-- Results lags
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS results_lag1 DECIMAL(10,2);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS results_lag2 DECIMAL(10,2);
COMMENT ON COLUMN ad_weekly_features.results_lag1 IS 'Results count week -1';
COMMENT ON COLUMN ad_weekly_features.results_lag2 IS 'Results count week -2';

-- Link CTR
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS link_ctr DECIMAL(10,6);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS link_ctr_delta_pct DECIMAL(10,4);
COMMENT ON COLUMN ad_weekly_features.link_ctr IS 'Current week link CTR';
COMMENT ON COLUMN ad_weekly_features.link_ctr_delta_pct IS 'Link CTR delta vs baseline';
