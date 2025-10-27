-- Add page_access_token column to user_accounts table
-- This stores the Facebook Page access token (different from user access token)
-- Used to fetch correct page data using pages_read_engagement permission

ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS page_access_token TEXT;

-- Add comment
COMMENT ON COLUMN user_accounts.page_access_token IS 'Facebook Page access token for the selected page';
