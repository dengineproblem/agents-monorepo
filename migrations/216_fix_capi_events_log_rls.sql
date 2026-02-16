-- Fix: capi_events_log RLS policy used user_account_id = auth.uid()
-- but user_account_id (from user_accounts.id) ≠ auth.uid() (from auth.users.id).
-- This blocked ALL frontend reads of CAPI events.
-- Disable RLS to match leads/other tables that rely on app-level filtering.

DROP POLICY IF EXISTS "Users can view own capi_events" ON capi_events_log;
DROP POLICY IF EXISTS "Service role full access to capi_events" ON capi_events_log;
ALTER TABLE capi_events_log DISABLE ROW LEVEL SECURITY;
