-- Migration 150: TikTok autopilot flag, platform in reports, creative grouping
-- Description: Adds autopilot_tiktok flags, platform tags for reports, and creative_group_id for cross-platform creatives.

-- =====================================================
-- 1. Autopilot flags for TikTok
-- =====================================================
ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS autopilot_tiktok BOOLEAN DEFAULT FALSE;

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS autopilot_tiktok BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN ad_accounts.autopilot_tiktok IS 'TikTok autopilot enabled flag';
COMMENT ON COLUMN user_accounts.autopilot_tiktok IS 'TikTok autopilot enabled flag (legacy mode)';

CREATE INDEX IF NOT EXISTS idx_ad_accounts_autopilot_tiktok
  ON ad_accounts(autopilot_tiktok);

CREATE INDEX IF NOT EXISTS idx_user_accounts_autopilot_tiktok
  ON user_accounts(autopilot_tiktok);

-- =====================================================
-- 2. Platform tags for brain executions and reports
-- =====================================================
ALTER TABLE brain_executions
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'facebook';

ALTER TABLE campaign_reports
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'facebook';

UPDATE brain_executions
  SET platform = 'facebook'
  WHERE platform IS NULL;

UPDATE campaign_reports
  SET platform = 'facebook'
  WHERE platform IS NULL;

CREATE INDEX IF NOT EXISTS idx_brain_executions_platform
  ON brain_executions(platform);

CREATE INDEX IF NOT EXISTS idx_campaign_reports_platform
  ON campaign_reports(platform);

COMMENT ON COLUMN brain_executions.platform IS 'Report platform: facebook or tiktok';
COMMENT ON COLUMN campaign_reports.platform IS 'Report platform: facebook or tiktok';

-- =====================================================
-- 3. Creative grouping for cross-platform sync
-- =====================================================
ALTER TABLE user_creatives
  ADD COLUMN IF NOT EXISTS creative_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_user_creatives_creative_group_id
  ON user_creatives(creative_group_id);

COMMENT ON COLUMN user_creatives.creative_group_id IS 'Group ID to link creatives across platforms';
