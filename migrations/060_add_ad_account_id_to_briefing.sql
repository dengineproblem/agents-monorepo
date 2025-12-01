-- Migration 060: Add ad_account_id to user_briefing_responses for multi-account support
-- Each advertising account can have its own briefing/prompts
-- SAFE: Only adds nullable column and updates constraint

-- 1. Add ad_account_id column
ALTER TABLE user_briefing_responses
ADD COLUMN ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE CASCADE;

-- 2. Drop old unique constraint (one brief per user)
ALTER TABLE user_briefing_responses
DROP CONSTRAINT IF EXISTS user_briefing_responses_user_id_key;

-- 3. Create new unique constraint (one brief per user + ad_account combination)
-- NULL ad_account_id means legacy mode (single account)
CREATE UNIQUE INDEX idx_user_briefing_unique_user_ad_account
ON user_briefing_responses(user_id, COALESCE(ad_account_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 4. Index for fast lookup
CREATE INDEX idx_user_briefing_responses_ad_account_id
ON user_briefing_responses(ad_account_id);

COMMENT ON COLUMN user_briefing_responses.ad_account_id IS
  'Привязка брифинга к рекламному аккаунту (для мультиаккаунтности). NULL = legacy режим.';
