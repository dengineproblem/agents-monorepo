-- Migration 117: Add baseline_quality and baseline_engagement to ad_weekly_features
-- Добавляет колонки для baseline ranking значений

ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_quality DECIMAL(3,1);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS baseline_engagement DECIMAL(3,1);

COMMENT ON COLUMN ad_weekly_features.baseline_quality IS 'Baseline quality ranking (медиана за 8 недель, 5=above, 3=avg, 1-2=below)';
COMMENT ON COLUMN ad_weekly_features.baseline_engagement IS 'Baseline engagement ranking (медиана за 8 недель, 5=above, 3=avg, 1-2=below)';
