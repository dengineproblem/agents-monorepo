-- Add platform and TikTok-specific settings to account_directions
-- Keep backward compatibility for Facebook-only users

-- =====================================================
-- 1. Platform column (facebook/tiktok/both)
-- =====================================================
ALTER TABLE account_directions
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'facebook';

UPDATE account_directions
  SET platform = CASE
    WHEN tiktok_campaign_id IS NOT NULL THEN 'tiktok'
    ELSE 'facebook'
  END
  WHERE platform IS NULL;

COMMENT ON COLUMN account_directions.platform IS
  'Traffic source platform for the direction: facebook, tiktok, or both. Default facebook for legacy rows.';

-- Allow same direction name per platform
ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS unique_direction_name_per_user;

ALTER TABLE account_directions
  ADD CONSTRAINT unique_direction_name_per_user_platform
  UNIQUE (user_account_id, name, platform);

CREATE INDEX IF NOT EXISTS idx_account_directions_platform
  ON account_directions(user_account_id, platform);

-- =====================================================
-- 2. TikTok-specific fields (nullable for backward compatibility)
-- =====================================================
ALTER TABLE account_directions
  ADD COLUMN IF NOT EXISTS tiktok_objective TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_daily_budget INTEGER,
  ADD COLUMN IF NOT EXISTS tiktok_target_cpl_kzt INTEGER,
  ADD COLUMN IF NOT EXISTS tiktok_target_cpl NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS tiktok_adgroup_mode TEXT;

COMMENT ON COLUMN account_directions.tiktok_objective IS
  'TikTok objective (e.g. traffic, conversions, lead_generation).';

COMMENT ON COLUMN account_directions.tiktok_daily_budget IS
  'TikTok daily budget in KZT.';

COMMENT ON COLUMN account_directions.tiktok_target_cpl_kzt IS
  'Target CPL for TikTok in KZT.';

COMMENT ON COLUMN account_directions.tiktok_target_cpl IS
  'Legacy target CPL for TikTok (numeric), if used.';

COMMENT ON COLUMN account_directions.tiktok_adgroup_mode IS
  'TikTok adgroup mode: use_existing or create_new.';

CREATE INDEX IF NOT EXISTS idx_account_directions_tiktok_campaign
  ON account_directions(tiktok_campaign_id)
  WHERE tiktok_campaign_id IS NOT NULL;
