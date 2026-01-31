-- Make email column nullable in consultants table
-- Created: 2026-01-31
-- Reason: Email field is not required for consultants

-- Remove NOT NULL constraint from email column
ALTER TABLE consultants
ALTER COLUMN email DROP NOT NULL;

-- Add comment
COMMENT ON COLUMN consultants.email IS 'Email address (optional)';
