-- Migration 127: Remove legacy ad_accounts entries
-- After migration 126, all insights are linked via user_account_id
-- Now we can safely remove ad_accounts for legacy users

-- ============================================================================
-- Step 1: Clear ad_account_id for legacy users in all insights tables
-- This breaks the FK before deletion
-- ============================================================================

-- Get legacy ad_account IDs for reference
-- Legacy = user_accounts where multi_account_enabled IS NULL OR FALSE

-- 1. meta_campaigns
UPDATE meta_campaigns mc
SET ad_account_id = NULL
WHERE ad_account_id IN (
  SELECT aa.id FROM ad_accounts aa
  JOIN user_accounts ua ON aa.user_account_id = ua.id
  WHERE ua.multi_account_enabled IS NULL OR ua.multi_account_enabled = false
);

-- 2. meta_adsets
UPDATE meta_adsets ms
SET ad_account_id = NULL
WHERE ad_account_id IN (
  SELECT aa.id FROM ad_accounts aa
  JOIN user_accounts ua ON aa.user_account_id = ua.id
  WHERE ua.multi_account_enabled IS NULL OR ua.multi_account_enabled = false
);

-- 3. meta_ads
UPDATE meta_ads ma
SET ad_account_id = NULL
WHERE ad_account_id IN (
  SELECT aa.id FROM ad_accounts aa
  JOIN user_accounts ua ON aa.user_account_id = ua.id
  WHERE ua.multi_account_enabled IS NULL OR ua.multi_account_enabled = false
);

-- 4. meta_insights_weekly
UPDATE meta_insights_weekly miw
SET ad_account_id = NULL
WHERE ad_account_id IN (
  SELECT aa.id FROM ad_accounts aa
  JOIN user_accounts ua ON aa.user_account_id = ua.id
  WHERE ua.multi_account_enabled IS NULL OR ua.multi_account_enabled = false
);

-- 5. meta_weekly_results
UPDATE meta_weekly_results mwr
SET ad_account_id = NULL
WHERE ad_account_id IN (
  SELECT aa.id FROM ad_accounts aa
  JOIN user_accounts ua ON aa.user_account_id = ua.id
  WHERE ua.multi_account_enabled IS NULL OR ua.multi_account_enabled = false
);

-- 6. ad_weekly_features
UPDATE ad_weekly_features awf
SET ad_account_id = NULL
WHERE ad_account_id IN (
  SELECT aa.id FROM ad_accounts aa
  JOIN user_accounts ua ON aa.user_account_id = ua.id
  WHERE ua.multi_account_enabled IS NULL OR ua.multi_account_enabled = false
);

-- 7. ad_weekly_anomalies
UPDATE ad_weekly_anomalies awa
SET ad_account_id = NULL
WHERE ad_account_id IN (
  SELECT aa.id FROM ad_accounts aa
  JOIN user_accounts ua ON aa.user_account_id = ua.id
  WHERE ua.multi_account_enabled IS NULL OR ua.multi_account_enabled = false
);

-- 8. insights_sync_jobs
UPDATE insights_sync_jobs isj
SET ad_account_id = NULL
WHERE ad_account_id IN (
  SELECT aa.id FROM ad_accounts aa
  JOIN user_accounts ua ON aa.user_account_id = ua.id
  WHERE ua.multi_account_enabled IS NULL OR ua.multi_account_enabled = false
);

-- 9. fb_rate_limit_state
UPDATE fb_rate_limit_state frl
SET ad_account_id = NULL
WHERE ad_account_id IN (
  SELECT aa.id FROM ad_accounts aa
  JOIN user_accounts ua ON aa.user_account_id = ua.id
  WHERE ua.multi_account_enabled IS NULL OR ua.multi_account_enabled = false
);

-- ============================================================================
-- Step 2: Delete ad_accounts for legacy users
-- ============================================================================
DELETE FROM ad_accounts
WHERE user_account_id IN (
  SELECT id FROM user_accounts
  WHERE multi_account_enabled IS NULL
     OR multi_account_enabled = false
);
