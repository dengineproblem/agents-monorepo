-- Migration 116: Add baseline_conversion to ad_weekly_features
-- Добавляет колонку baseline_conversion для расчёта ranking deviations

ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_conversion DECIMAL(3,1);

COMMENT ON COLUMN ad_weekly_features.baseline_conversion IS 'Baseline conversion ranking (медиана за 8 недель, 5=above, 3=avg, 1-2=below)';
