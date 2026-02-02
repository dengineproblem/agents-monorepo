-- Migration 178: Rollback Tilda Webhook Support (Migration 006)
-- Date: 2026-02-02
--
-- Rollback changes from accidentally applied migration:
-- 1. Drop message field from leads table
-- 2. Drop tilda_utm_field from ad_accounts table
-- 3. Drop index for message search
-- 4. Drop constraint for tilda_utm_field

-- ============================================================================
-- 1. DROP INDEX
-- ============================================================================

-- Drop GIN index for message field
DROP INDEX IF EXISTS idx_leads_message;

-- ============================================================================
-- 2. DROP CONSTRAINT
-- ============================================================================

-- Drop constraint for tilda_utm_field
ALTER TABLE ad_accounts DROP CONSTRAINT IF EXISTS ad_accounts_tilda_utm_field_check;

-- ============================================================================
-- 3. DROP COLUMNS
-- ============================================================================

-- Drop tilda_utm_field from ad_accounts table
ALTER TABLE ad_accounts DROP COLUMN IF EXISTS tilda_utm_field;

-- Drop message field from leads table
ALTER TABLE leads DROP COLUMN IF EXISTS message;

-- ============================================================================
-- SUMMARY
-- ============================================================================
/*
Removed columns:
- leads.message (TEXT)
- ad_accounts.tilda_utm_field (TEXT)

Removed indexes:
- idx_leads_message

Removed constraints:
- ad_accounts_tilda_utm_field_check

This migration rolls back changes from migration 006 (Tilda Webhook Support)
that was accidentally applied from another project.
*/
