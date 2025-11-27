-- Migration: Add fb_connection_status field for manual Facebook connection
-- This field tracks the status of manual Facebook connection requests

ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS fb_connection_status VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN user_accounts.fb_connection_status IS 'Status of manual FB connection: pending_review, approved, rejected, or NULL for OAuth';
