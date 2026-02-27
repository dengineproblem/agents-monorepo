-- Migration: 227_enable_rls_phase2.sql
-- Description: Phase 2 RLS — lock ALL remaining tables used by frontend
-- Date: 2026-02-26
--
-- Phase 1 (migration 226) locked: user_accounts, ad_accounts, default_ad_settings
-- Phase 2 locks ALL remaining tables that had direct frontend access via anon key.
-- Frontend code has been migrated to use backend API (Fastify service_role routes).
--
-- Tables locked in this migration (20 tables):
--   leads, purchases, user_creatives, generated_creatives, creative_transcripts,
--   creative_tests, creative_metrics_history, ad_creative_mapping, capi_events_log,
--   creative_analysis, dialog_analysis, whatsapp_instances, n8n_chat_histories,
--   follow_up_simple, consultants, consultations, user_directions, planned_metrics,
--   campaign_reports, targetolog_actions
--
-- Also includes: account_directions, video_uploads (belt-and-suspenders)

BEGIN;

-- ============================================
-- 1. List of ALL tables to lock
-- ============================================

DO $$
DECLARE
  tbl text;
  pol record;
  tables_to_lock text[] := ARRAY[
    'leads',
    'purchases',
    'user_creatives',
    'generated_creatives',
    'creative_transcripts',
    'creative_tests',
    'creative_metrics_history',
    'ad_creative_mapping',
    'capi_events_log',
    'creative_analysis',
    'dialog_analysis',
    'whatsapp_instances',
    'n8n_chat_histories',
    'follow_up_simple',
    'consultants',
    'consultations',
    'user_directions',
    'planned_metrics',
    'campaign_reports',
    'targetolog_actions',
    'account_directions',
    'video_uploads'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_to_lock LOOP
    -- Skip if table doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      RAISE NOTICE 'Table % does not exist, skipping', tbl;
      CONTINUE;
    END IF;

    -- Enable RLS + FORCE
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);

    -- Drop ALL existing policies (they use auth.uid() which is always NULL for anon)
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    -- Create service_role-only policy
    -- anon key → blocked (empty results)
    -- service_role key (all backends) → full access (bypasses RLS automatically)
    EXECUTE format(
      'CREATE POLICY "service_role_only" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      tbl
    );

    RAISE NOTICE 'Locked table: %', tbl;
  END LOOP;
END $$;

COMMIT;

-- ============================================
-- VERIFICATION (run after applying):
-- ============================================
-- 1. Check RLS is enabled on all tables:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname = 'public' AND rowsecurity = true
--   ORDER BY tablename;
--   Expected: 25 tables (3 from phase 1 + 22 from phase 2)
--
-- 2. Test anon access is blocked (pick any table):
--   curl -s "https://ikywuvtavpnjlrjtalqi.supabase.co/rest/v1/leads?select=id&limit=1" \
--     -H "apikey: <anon_key>" -H "Authorization: Bearer <anon_key>"
--   Expected: [] (empty array)
--
-- 3. Test service_role still works:
--   curl -s "https://ikywuvtavpnjlrjtalqi.supabase.co/rest/v1/leads?select=id&limit=1" \
--     -H "apikey: <service_role_key>" -H "Authorization: Bearer <service_role_key>"
--   Expected: [{id: "..."}]
--
-- 4. Test app works end-to-end: login, view dashboard, leads, creatives, dialogs
