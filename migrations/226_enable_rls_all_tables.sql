-- Migration: 226_enable_rls_critical_tables.sql
-- Description: CRITICAL SECURITY FIX — Enable RLS on user_accounts, ad_accounts, default_ad_settings
-- Date: 2026-02-26
--
-- PROBLEM: Supabase anon key gives full CRUD access to ALL tables without authentication.
--   - 233 user_accounts with Facebook tokens, Telegram bot tokens, plaintext passwords
--   - 13 ad_accounts with access tokens and CRM secrets
--   - 273 default_ad_settings
--
-- SOLUTION: Enable RLS on the 3 tables that frontend no longer queries directly.
--   - Frontend code has been migrated to use backend API (/user/profile, /ad-accounts/*)
--   - All backends use service_role key → they bypass RLS → no breakage
--   - Other tables (leads, purchases, creatives, etc.) remain accessible for now
--     until their frontend code is also migrated to backend APIs
--
-- PHASE 2 (future): Lock remaining tables after migrating salesApi, creativesApi,
--   plansApi, consultationService, dialogAnalysisService, chatService to backend APIs

BEGIN;

-- ============================================
-- 1. ENABLE RLS + FORCE on critical tables
-- ============================================

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.default_ad_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.default_ad_settings FORCE ROW LEVEL SECURITY;

-- ============================================
-- 2. DROP old broken policies (auth.uid() is always NULL)
-- ============================================

DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['user_accounts', 'ad_accounts', 'default_ad_settings'] LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;
  END LOOP;
END $$;

-- ============================================
-- 3. CREATE service_role-only policies
-- ============================================
-- anon key → blocked (empty results)
-- service_role key (all backends) → full access (bypasses RLS)

CREATE POLICY "service_role_only" ON public.user_accounts
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_only" ON public.ad_accounts
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_only" ON public.default_ad_settings
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;

-- ============================================
-- VERIFICATION (run after applying):
-- ============================================
-- 1. Check RLS is enabled:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE tablename IN ('user_accounts', 'ad_accounts', 'default_ad_settings');
--   Expected: all true
--
-- 2. Test anon access is blocked:
--   curl -s "https://ikywuvtavpnjlrjtalqi.supabase.co/rest/v1/user_accounts?select=id&limit=1" \
--     -H "apikey: <anon_key>" -H "Authorization: Bearer <anon_key>"
--   Expected: [] (empty array)
--
-- 3. Verify backend still works (service_role bypasses RLS):
--   curl -s "https://ikywuvtavpnjlrjtalqi.supabase.co/rest/v1/user_accounts?select=id&limit=1" \
--     -H "apikey: <service_role_key>" -H "Authorization: Bearer <service_role_key>"
--   Expected: [{id: "..."}]
