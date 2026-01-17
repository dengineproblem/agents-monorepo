-- Migration 159: Add platform and ttclid columns for TikTok CAPI support
-- Date: 2025-01-16
-- Description: Добавляет platform в capi_events_log и ttclid для TikTok lead attribution
-- SAFE: Only adds nullable columns

-- 1. Add platform to capi_events_log
ALTER TABLE capi_events_log
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'facebook';

CREATE INDEX IF NOT EXISTS idx_capi_events_log_platform
  ON capi_events_log(platform);

COMMENT ON COLUMN capi_events_log.platform IS 'Platform: facebook or tiktok';

-- 2. Add ttclid (TikTok Click ID) to capi_events_log
ALTER TABLE capi_events_log
  ADD COLUMN IF NOT EXISTS ttclid TEXT;

CREATE INDEX IF NOT EXISTS idx_capi_events_log_ttclid
  ON capi_events_log(ttclid) WHERE ttclid IS NOT NULL;

COMMENT ON COLUMN capi_events_log.ttclid IS 'TikTok Click ID for attribution (similar to ctwa_clid for Facebook)';

-- 3. Add ttclid to leads table
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ttclid TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_ttclid
  ON leads(ttclid) WHERE ttclid IS NOT NULL;

COMMENT ON COLUMN leads.ttclid IS 'TikTok Click ID for attribution';

-- 4. Add ttclid to dialog_analysis table
ALTER TABLE dialog_analysis
  ADD COLUMN IF NOT EXISTS ttclid TEXT;

CREATE INDEX IF NOT EXISTS idx_dialog_analysis_ttclid
  ON dialog_analysis(ttclid) WHERE ttclid IS NOT NULL;

COMMENT ON COLUMN dialog_analysis.ttclid IS 'TikTok Click ID from leads, used for CAPI events';
