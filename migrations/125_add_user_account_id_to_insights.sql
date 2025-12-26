-- Migration 125: Add user_account_id to insights tables
-- This allows insights to be linked directly to user_accounts for legacy mode
-- Legacy: user_account_id NOT NULL, ad_account_id NULL
-- Multi-account: ad_account_id NOT NULL (user_account_id can be derived)

-- ============================================================================
-- 1. meta_campaigns
-- ============================================================================
ALTER TABLE meta_campaigns
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

ALTER TABLE meta_campaigns
ALTER COLUMN ad_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_user_account_id
ON meta_campaigns(user_account_id);

-- ============================================================================
-- 2. meta_adsets
-- ============================================================================
ALTER TABLE meta_adsets
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

ALTER TABLE meta_adsets
ALTER COLUMN ad_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_adsets_user_account_id
ON meta_adsets(user_account_id);

-- ============================================================================
-- 3. meta_ads
-- ============================================================================
ALTER TABLE meta_ads
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

ALTER TABLE meta_ads
ALTER COLUMN ad_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_ads_user_account_id
ON meta_ads(user_account_id);

-- ============================================================================
-- 4. meta_insights_weekly
-- ============================================================================
ALTER TABLE meta_insights_weekly
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

ALTER TABLE meta_insights_weekly
ALTER COLUMN ad_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_insights_weekly_user_account_id
ON meta_insights_weekly(user_account_id);

-- ============================================================================
-- 5. meta_weekly_results
-- ============================================================================
ALTER TABLE meta_weekly_results
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

ALTER TABLE meta_weekly_results
ALTER COLUMN ad_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_weekly_results_user_account_id
ON meta_weekly_results(user_account_id);

-- ============================================================================
-- 6. ad_weekly_features
-- ============================================================================
ALTER TABLE ad_weekly_features
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

ALTER TABLE ad_weekly_features
ALTER COLUMN ad_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_weekly_features_user_account_id
ON ad_weekly_features(user_account_id);

-- ============================================================================
-- 7. ad_weekly_anomalies
-- ============================================================================
ALTER TABLE ad_weekly_anomalies
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

ALTER TABLE ad_weekly_anomalies
ALTER COLUMN ad_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_weekly_anomalies_user_account_id
ON ad_weekly_anomalies(user_account_id);

-- ============================================================================
-- 8. insights_sync_jobs
-- ============================================================================
ALTER TABLE insights_sync_jobs
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

ALTER TABLE insights_sync_jobs
ALTER COLUMN ad_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insights_sync_jobs_user_account_id
ON insights_sync_jobs(user_account_id);

-- ============================================================================
-- 9. fb_rate_limit_state
-- ============================================================================
ALTER TABLE fb_rate_limit_state
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

ALTER TABLE fb_rate_limit_state
ALTER COLUMN ad_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fb_rate_limit_state_user_account_id
ON fb_rate_limit_state(user_account_id);

-- ============================================================================
-- Add CHECK constraints to ensure at least one ID is present
-- ============================================================================
ALTER TABLE meta_campaigns
ADD CONSTRAINT chk_meta_campaigns_account_id
CHECK (user_account_id IS NOT NULL OR ad_account_id IS NOT NULL);

ALTER TABLE meta_adsets
ADD CONSTRAINT chk_meta_adsets_account_id
CHECK (user_account_id IS NOT NULL OR ad_account_id IS NOT NULL);

ALTER TABLE meta_ads
ADD CONSTRAINT chk_meta_ads_account_id
CHECK (user_account_id IS NOT NULL OR ad_account_id IS NOT NULL);

ALTER TABLE meta_insights_weekly
ADD CONSTRAINT chk_meta_insights_weekly_account_id
CHECK (user_account_id IS NOT NULL OR ad_account_id IS NOT NULL);

ALTER TABLE meta_weekly_results
ADD CONSTRAINT chk_meta_weekly_results_account_id
CHECK (user_account_id IS NOT NULL OR ad_account_id IS NOT NULL);

ALTER TABLE ad_weekly_features
ADD CONSTRAINT chk_ad_weekly_features_account_id
CHECK (user_account_id IS NOT NULL OR ad_account_id IS NOT NULL);

ALTER TABLE ad_weekly_anomalies
ADD CONSTRAINT chk_ad_weekly_anomalies_account_id
CHECK (user_account_id IS NOT NULL OR ad_account_id IS NOT NULL);

ALTER TABLE insights_sync_jobs
ADD CONSTRAINT chk_insights_sync_jobs_account_id
CHECK (user_account_id IS NOT NULL OR ad_account_id IS NOT NULL);

ALTER TABLE fb_rate_limit_state
ADD CONSTRAINT chk_fb_rate_limit_state_account_id
CHECK (user_account_id IS NOT NULL OR ad_account_id IS NOT NULL);

-- ============================================================================
-- Add unique indexes for legacy mode (user_account_id based)
-- ============================================================================

-- meta_campaigns
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_campaigns_legacy_unique
ON meta_campaigns(user_account_id, fb_campaign_id)
WHERE user_account_id IS NOT NULL AND ad_account_id IS NULL;

-- meta_adsets
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_adsets_legacy_unique
ON meta_adsets(user_account_id, fb_adset_id)
WHERE user_account_id IS NOT NULL AND ad_account_id IS NULL;

-- meta_ads
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_ads_legacy_unique
ON meta_ads(user_account_id, fb_ad_id)
WHERE user_account_id IS NOT NULL AND ad_account_id IS NULL;

-- meta_insights_weekly
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_weekly_legacy_unique
ON meta_insights_weekly(user_account_id, fb_ad_id, week_start_date)
WHERE user_account_id IS NOT NULL AND ad_account_id IS NULL;

-- meta_weekly_results
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_weekly_results_legacy_unique
ON meta_weekly_results(user_account_id, fb_ad_id, week_start_date, result_family)
WHERE user_account_id IS NOT NULL AND ad_account_id IS NULL;

-- ad_weekly_features
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_weekly_features_legacy_unique
ON ad_weekly_features(user_account_id, fb_ad_id, week_start_date)
WHERE user_account_id IS NOT NULL AND ad_account_id IS NULL;

-- ad_weekly_anomalies
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_weekly_anomalies_legacy_unique
ON ad_weekly_anomalies(user_account_id, fb_ad_id, week_start_date, result_family, anomaly_type)
WHERE user_account_id IS NOT NULL AND ad_account_id IS NULL;

-- fb_rate_limit_state
CREATE UNIQUE INDEX IF NOT EXISTS idx_fb_rate_limit_state_legacy_unique
ON fb_rate_limit_state(user_account_id)
WHERE user_account_id IS NOT NULL AND ad_account_id IS NULL;

-- Comments
COMMENT ON COLUMN meta_campaigns.user_account_id IS 'Direct link to user_accounts for legacy mode. NULL for multi-account mode.';
COMMENT ON COLUMN meta_adsets.user_account_id IS 'Direct link to user_accounts for legacy mode. NULL for multi-account mode.';
COMMENT ON COLUMN meta_ads.user_account_id IS 'Direct link to user_accounts for legacy mode. NULL for multi-account mode.';
