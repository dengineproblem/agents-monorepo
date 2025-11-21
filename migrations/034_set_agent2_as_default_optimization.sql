-- Migration: Set agent2 as default optimization for new users
-- This ensures all new users will have agent2 optimization mode by default

-- Update the default value for optimization column
ALTER TABLE user_accounts 
ALTER COLUMN optimization SET DEFAULT 'agent2';

-- Add comment to document the change
COMMENT ON COLUMN user_accounts.optimization IS 'Optimization strategy: lead_cost, qual_lead, roi, agent2 (default)';

