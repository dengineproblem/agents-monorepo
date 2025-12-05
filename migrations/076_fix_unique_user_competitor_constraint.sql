-- Fix unique constraint on user_competitors to include account_id
-- This allows the same competitor to be linked to multiple ad_accounts of the same user

-- Drop old constraint that only checked user_account_id + competitor_id
ALTER TABLE user_competitors DROP CONSTRAINT IF EXISTS unique_user_competitor;

-- Create new unique constraint that includes account_id
-- Uses COALESCE to handle NULL account_id (legacy mode)
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_competitor_with_account
ON user_competitors (
  user_account_id,
  competitor_id,
  COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

COMMENT ON INDEX unique_user_competitor_with_account IS
'Unique constraint: one competitor per user per ad_account. NULL account_id treated as separate value for legacy mode.';
