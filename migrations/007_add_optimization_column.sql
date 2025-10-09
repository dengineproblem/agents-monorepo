-- Migration: Add optimization column to user_accounts
-- This column controls which optimization strategy is used for the user
-- Values: 'Manual', 'Agent 1', 'Agent 2'

-- Add optimization column if it doesn't exist
ALTER TABLE user_accounts 
ADD COLUMN IF NOT EXISTS optimization TEXT DEFAULT 'Manual';

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_user_accounts_optimization 
ON user_accounts(optimization) 
WHERE active = true;

-- Add comment
COMMENT ON COLUMN user_accounts.optimization IS 'Optimization strategy: Manual, Agent 1, or Agent 2';

