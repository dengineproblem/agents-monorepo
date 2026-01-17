-- Migration 158: Add platform column to creative_metrics_history
-- Date: 2025-01-16
-- Description: Добавляет колонку platform для разделения Facebook и TikTok метрик
-- SAFE: Only adds nullable column with default

ALTER TABLE creative_metrics_history
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'facebook';

-- Index for platform filtering (used in ROI Analytics)
CREATE INDEX IF NOT EXISTS idx_creative_metrics_history_platform
  ON creative_metrics_history(platform);

-- Update unique constraint to include platform
-- Old: (user_account_id, ad_id, date) WHERE ad_id IS NOT NULL
-- New: (user_account_id, ad_id, date, platform) WHERE ad_id IS NOT NULL
DROP INDEX IF EXISTS creative_metrics_ad_date_unique;
CREATE UNIQUE INDEX IF NOT EXISTS creative_metrics_ad_date_platform_unique
  ON creative_metrics_history(user_account_id, ad_id, date, platform)
  WHERE ad_id IS NOT NULL;

-- Same for adset-based constraint (legacy)
DROP INDEX IF EXISTS creative_metrics_adset_unique;
CREATE UNIQUE INDEX IF NOT EXISTS creative_metrics_adset_platform_unique
  ON creative_metrics_history(user_account_id, adset_id, date, platform)
  WHERE adset_id IS NOT NULL AND ad_id IS NULL;

COMMENT ON COLUMN creative_metrics_history.platform IS 'Platform: facebook or tiktok';
