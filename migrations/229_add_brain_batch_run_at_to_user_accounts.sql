-- Migration: 229_add_brain_batch_run_at_to_user_accounts.sql
-- Description: Add last_brain_batch_run_at to user_accounts for timezone-aware legacy scheduling dedup
-- Analogous to ad_accounts.last_brain_batch_run_at (migration 143)
-- Date: 2026-02-27

ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS last_brain_batch_run_at TIMESTAMPTZ;

COMMENT ON COLUMN user_accounts.last_brain_batch_run_at IS 'Время последнего запуска Brain batch для legacy пользователя (дедупликация)';
