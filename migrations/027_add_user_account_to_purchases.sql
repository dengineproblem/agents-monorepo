-- Migration 027: Add user_account_id to purchases table
-- Description: Migrate purchases table to use user_account_id instead of business_id
-- Date: 2025-11-05

-- ============================================================================
-- 1. Add user_account_id column to purchases
-- ============================================================================

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

COMMENT ON COLUMN purchases.user_account_id IS 'User account that owns this purchase';

-- ============================================================================
-- 2. Migrate existing data: match business_id to whatsapp_phone_numbers
-- ============================================================================

-- Update purchases with user_account_id from leads table (via client_phone match)
UPDATE purchases p
SET user_account_id = l.user_account_id
FROM leads l
WHERE p.client_phone = l.chat_id
  AND p.user_account_id IS NULL
  AND l.user_account_id IS NOT NULL;

-- Log migration results
DO $$
DECLARE
  migrated_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM purchases;
  SELECT COUNT(*) INTO migrated_count FROM purchases WHERE user_account_id IS NOT NULL;
  
  RAISE NOTICE 'Purchases migration: % out of % records migrated', migrated_count, total_count;
END $$;

-- ============================================================================
-- 3. Create indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_purchases_user_account 
  ON purchases(user_account_id) 
  WHERE user_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_user_account_created 
  ON purchases(user_account_id, created_at DESC) 
  WHERE user_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_client_phone 
  ON purchases(client_phone);

-- ============================================================================
-- 4. Update comment on business_id (mark as legacy)
-- ============================================================================

COMMENT ON COLUMN purchases.business_id IS 'LEGACY: WhatsApp business phone number. Use user_account_id for new queries.';

-- ============================================================================
-- 5. Add constraint to ensure at least one identifier exists
-- ============================================================================

-- For new records, we'll enforce user_account_id in application logic
-- but keep both fields nullable for backward compatibility

ALTER TABLE purchases
  ALTER COLUMN business_id DROP NOT NULL;

COMMENT ON TABLE purchases IS 'Customer purchases. Use user_account_id for filtering, business_id is legacy.';






