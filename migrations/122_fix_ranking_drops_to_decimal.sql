-- Migration 122: Change ranking drop columns from SMALLINT to DECIMAL
-- Проблема: baseline_quality/engagement/conversion - медиана (может быть 1.5)
-- Соответственно drop = score - baseline может быть дробным (3 - 1.5 = 1.5)

ALTER TABLE ad_weekly_features
ALTER COLUMN quality_drop TYPE DECIMAL(3,1),
ALTER COLUMN engagement_drop TYPE DECIMAL(3,1),
ALTER COLUMN conversion_drop TYPE DECIMAL(3,1),
ALTER COLUMN relevance_drop TYPE DECIMAL(4,1);

COMMENT ON COLUMN ad_weekly_features.quality_drop IS 'Quality score drop vs baseline (может быть дробным)';
COMMENT ON COLUMN ad_weekly_features.engagement_drop IS 'Engagement score drop vs baseline (может быть дробным)';
COMMENT ON COLUMN ad_weekly_features.conversion_drop IS 'Conversion score drop vs baseline (может быть дробным)';
COMMENT ON COLUMN ad_weekly_features.relevance_drop IS 'Relevance health drop vs baseline (может быть дробным)';
