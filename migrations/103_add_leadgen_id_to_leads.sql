-- Migration 103: Add leadgen_id column to leads table for Facebook Lead Forms
-- This stores the Facebook leadgen_id for tracking and deduplication

-- Add leadgen_id column
ALTER TABLE leads ADD COLUMN IF NOT EXISTS leadgen_id TEXT;

-- Add index for lookups by leadgen_id (for deduplication)
CREATE INDEX IF NOT EXISTS idx_leads_leadgen_id ON leads(leadgen_id) WHERE leadgen_id IS NOT NULL;

-- Add unique constraint to prevent duplicate leads from same form submission
-- Note: Using partial unique index to allow NULL values
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_leadgen_id_unique
ON leads(leadgen_id)
WHERE leadgen_id IS NOT NULL;

-- Comment explaining the column
COMMENT ON COLUMN leads.leadgen_id IS 'Facebook Lead Form submission ID (leadgen_id from webhook)';
