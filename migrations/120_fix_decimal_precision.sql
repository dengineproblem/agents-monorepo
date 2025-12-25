-- Migration 120: Fix decimal precision for delta fields
-- Увеличиваем precision для полей которые могут превышать 100%

-- Link CTR delta может быть большим (например +500%)
ALTER TABLE ad_weekly_features ALTER COLUMN link_ctr_delta_pct TYPE DECIMAL(12,4);

-- Другие delta поля тоже могут превышать 100%
ALTER TABLE ad_weekly_features ALTER COLUMN results_delta_pct TYPE DECIMAL(12,4);
ALTER TABLE ad_weekly_features ALTER COLUMN cpr_delta_pct TYPE DECIMAL(12,4);
ALTER TABLE ad_weekly_features ALTER COLUMN freq_delta_pct TYPE DECIMAL(12,4);
ALTER TABLE ad_weekly_features ALTER COLUMN ctr_delta_pct TYPE DECIMAL(12,4);
ALTER TABLE ad_weekly_features ALTER COLUMN cpc_delta_pct TYPE DECIMAL(12,4);
ALTER TABLE ad_weekly_features ALTER COLUMN cpm_delta_pct TYPE DECIMAL(12,4);
ALTER TABLE ad_weekly_features ALTER COLUMN spend_delta_pct TYPE DECIMAL(12,4);

-- Link CTR value (может быть 0-100%)
ALTER TABLE ad_weekly_features ALTER COLUMN link_ctr TYPE DECIMAL(10,6);
