-- Fix user_competitors with NULL account_id for multi-account users
-- This updates competitors created before the account_id fix was deployed

-- For user 36f011b1-0ae7-4b9d-aaee-c979a295ed11, link to their ad_account
UPDATE user_competitors
SET account_id = '91991aa6-558d-4a7b-9de9-771fe520e330'
WHERE user_account_id = '36f011b1-0ae7-4b9d-aaee-c979a295ed11'
  AND account_id IS NULL;

-- Generic fix: for multi-account users with NULL account_id,
-- link to their default ad_account
UPDATE user_competitors uc
SET account_id = (
  SELECT aa.id
  FROM ad_accounts aa
  WHERE aa.user_account_id = uc.user_account_id
    AND aa.is_default = true
  LIMIT 1
)
WHERE uc.account_id IS NULL
  AND EXISTS (
    SELECT 1 FROM user_accounts ua
    WHERE ua.id = uc.user_account_id
      AND ua.multi_account_enabled = true
  );
