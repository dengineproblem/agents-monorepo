-- Migration 126: Populate user_account_id for existing insights records
-- This migration fills user_account_id from ad_accounts.user_account_id
-- for all existing records that have ad_account_id

-- ============================================================================
-- 1. meta_campaigns
-- ============================================================================
UPDATE meta_campaigns mc
SET user_account_id = aa.user_account_id
FROM ad_accounts aa
WHERE mc.ad_account_id = aa.id
  AND mc.user_account_id IS NULL;

-- ============================================================================
-- 2. meta_adsets
-- ============================================================================
UPDATE meta_adsets ms
SET user_account_id = aa.user_account_id
FROM ad_accounts aa
WHERE ms.ad_account_id = aa.id
  AND ms.user_account_id IS NULL;

-- ============================================================================
-- 3. meta_ads
-- ============================================================================
UPDATE meta_ads ma
SET user_account_id = aa.user_account_id
FROM ad_accounts aa
WHERE ma.ad_account_id = aa.id
  AND ma.user_account_id IS NULL;

-- ============================================================================
-- 4. meta_insights_weekly
-- ============================================================================
UPDATE meta_insights_weekly miw
SET user_account_id = aa.user_account_id
FROM ad_accounts aa
WHERE miw.ad_account_id = aa.id
  AND miw.user_account_id IS NULL;

-- ============================================================================
-- 5. meta_weekly_results
-- ============================================================================
UPDATE meta_weekly_results mwr
SET user_account_id = aa.user_account_id
FROM ad_accounts aa
WHERE mwr.ad_account_id = aa.id
  AND mwr.user_account_id IS NULL;

-- ============================================================================
-- 6. ad_weekly_features
-- ============================================================================
UPDATE ad_weekly_features awf
SET user_account_id = aa.user_account_id
FROM ad_accounts aa
WHERE awf.ad_account_id = aa.id
  AND awf.user_account_id IS NULL;

-- ============================================================================
-- 7. ad_weekly_anomalies
-- ============================================================================
UPDATE ad_weekly_anomalies awa
SET user_account_id = aa.user_account_id
FROM ad_accounts aa
WHERE awa.ad_account_id = aa.id
  AND awa.user_account_id IS NULL;

-- ============================================================================
-- 8. insights_sync_jobs
-- ============================================================================
UPDATE insights_sync_jobs isj
SET user_account_id = aa.user_account_id
FROM ad_accounts aa
WHERE isj.ad_account_id = aa.id
  AND isj.user_account_id IS NULL;

-- ============================================================================
-- 9. fb_rate_limit_state
-- ============================================================================
UPDATE fb_rate_limit_state frl
SET user_account_id = aa.user_account_id
FROM ad_accounts aa
WHERE frl.ad_account_id = aa.id
  AND frl.user_account_id IS NULL;
