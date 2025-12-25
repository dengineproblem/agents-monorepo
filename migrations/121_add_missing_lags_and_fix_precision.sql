-- Migration 121: Add missing lag columns and fix remaining precision issues
-- Добавляет недостающие lag колонки и исправляет precision для полей которые могут превышать 100%

-- 1. Добавляем недостающие lag колонки
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS cpm_lag1 DECIMAL(10,4);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS cpm_lag2 DECIMAL(10,4);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS spend_lag1 DECIMAL(12,2);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS spend_lag2 DECIMAL(12,2);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS link_ctr_lag1 DECIMAL(10,6);
ALTER TABLE ad_weekly_features ADD COLUMN IF NOT EXISTS link_ctr_lag2 DECIMAL(10,6);

COMMENT ON COLUMN ad_weekly_features.cpm_lag1 IS 'CPM week -1';
COMMENT ON COLUMN ad_weekly_features.cpm_lag2 IS 'CPM week -2';
COMMENT ON COLUMN ad_weekly_features.spend_lag1 IS 'Spend week -1';
COMMENT ON COLUMN ad_weekly_features.spend_lag2 IS 'Spend week -2';
COMMENT ON COLUMN ad_weekly_features.link_ctr_lag1 IS 'Link CTR week -1';
COMMENT ON COLUMN ad_weekly_features.link_ctr_lag2 IS 'Link CTR week -2';

-- 2. Исправляем precision для полей которые могут превышать 100%
-- reach_growth_rate может быть +200%, +500% и т.д.
ALTER TABLE ad_weekly_features ALTER COLUMN reach_growth_rate TYPE DECIMAL(12,4);

-- freq_slope и ctr_slope - тренды, могут быть большими
ALTER TABLE ad_weekly_features ALTER COLUMN freq_slope TYPE DECIMAL(12,6);
ALTER TABLE ad_weekly_features ALTER COLUMN ctr_slope TYPE DECIMAL(12,6);

-- spend_change_pct уже DECIMAL(8,4), но для consistency меняем на DECIMAL(12,4)
ALTER TABLE ad_weekly_features ALTER COLUMN spend_change_pct TYPE DECIMAL(12,4);

