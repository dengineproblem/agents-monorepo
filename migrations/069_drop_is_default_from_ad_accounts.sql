-- Migration 069: Drop is_default column from ad_accounts
-- Removes the is_default field as we now rely on frontend-stored currentAdAccountId
-- The user selects their active account in the UI, no need for server-side default

-- Drop the trigger first (if exists)
DROP TRIGGER IF EXISTS ensure_single_default_ad_account ON ad_accounts;
DROP TRIGGER IF EXISTS trigger_single_default_ad_account ON ad_accounts;
DROP FUNCTION IF EXISTS ensure_single_default_ad_account() CASCADE;

-- Drop the partial unique index for is_default
DROP INDEX IF EXISTS idx_ad_accounts_default;

-- Drop the column (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_accounts'
    AND column_name = 'is_default'
  ) THEN
    ALTER TABLE ad_accounts DROP COLUMN is_default;
    RAISE NOTICE 'Dropped is_default column from ad_accounts';
  ELSE
    RAISE NOTICE 'Column is_default does not exist in ad_accounts, skipping';
  END IF;
END $$;
