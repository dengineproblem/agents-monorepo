-- Migration: 106_fix_rls_security_policies.sql
-- Description: Fix overly permissive RLS policies that allow access to all users
-- Date: 2024-12-21
-- SECURITY FIX: Replace USING(true) with proper role-based checks

-- ============================================
-- 1. ai_conversations - Fix open access policy
-- ============================================
DROP POLICY IF EXISTS "Service role full access" ON ai_conversations;

CREATE POLICY "Service role access" ON ai_conversations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Users access own conversations" ON ai_conversations
  FOR ALL
  USING (user_account_id::text = auth.uid()::text)
  WITH CHECK (user_account_id::text = auth.uid()::text);

-- ============================================
-- 2. ai_messages - Fix open access policy
-- ============================================
DROP POLICY IF EXISTS "Service role full access" ON ai_messages;

CREATE POLICY "Service role access" ON ai_messages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Users access own messages" ON ai_messages
  FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM ai_conversations
      WHERE user_account_id::text = auth.uid()::text
    )
  );

-- ============================================
-- 3. ai_pending_plans - Fix open access policy
-- ============================================
DROP POLICY IF EXISTS "Service role full access" ON ai_pending_plans;

CREATE POLICY "Service role access" ON ai_pending_plans
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 4. account_directions - Fix open access policy
-- ============================================
DROP POLICY IF EXISTS "Service role full access" ON account_directions;

CREATE POLICY "Service role access" ON account_directions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Users read own directions" ON account_directions
  FOR SELECT
  USING (
    ad_account_id IN (
      SELECT id FROM ad_accounts
      WHERE user_account_id::text = auth.uid()::text
    )
  );

-- ============================================
-- 5. creative_analysis - Fix open access policy
-- ============================================
DROP POLICY IF EXISTS "Allow all" ON creative_analysis;
DROP POLICY IF EXISTS "Service role full access" ON creative_analysis;

CREATE POLICY "Service role access" ON creative_analysis
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Users read own creative analysis" ON creative_analysis
  FOR SELECT
  USING (
    ad_account_id IN (
      SELECT id FROM ad_accounts
      WHERE user_account_id::text = auth.uid()::text
    )
  );

-- ============================================
-- 6. telegram_onboarding_sessions - Fix open access policy
-- ============================================
DROP POLICY IF EXISTS "Service role full access" ON telegram_onboarding_sessions;

CREATE POLICY "Service role access" ON telegram_onboarding_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 7. ai_idempotent_operations - Fix open access policy
-- ============================================
DROP POLICY IF EXISTS "Service role full access" ON ai_idempotent_operations;

CREATE POLICY "Service role access" ON ai_idempotent_operations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 8. whatsapp_phone_numbers - Enable RLS (was commented out)
-- ============================================
ALTER TABLE whatsapp_phone_numbers ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "Service role access" ON whatsapp_phone_numbers;
DROP POLICY IF EXISTS "Users access own numbers" ON whatsapp_phone_numbers;

CREATE POLICY "Service role access" ON whatsapp_phone_numbers
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Users read own whatsapp numbers" ON whatsapp_phone_numbers
  FOR SELECT
  USING (
    ad_account_id IN (
      SELECT id FROM ad_accounts
      WHERE user_account_id::text = auth.uid()::text
    )
  );

-- ============================================
-- Verification query (run manually to check)
-- ============================================
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
-- FROM pg_policies
-- WHERE tablename IN (
--   'ai_conversations', 'ai_messages', 'ai_pending_plans',
--   'account_directions', 'creative_analysis',
--   'telegram_onboarding_sessions', 'ai_idempotent_operations',
--   'whatsapp_phone_numbers'
-- )
-- ORDER BY tablename, policyname;
