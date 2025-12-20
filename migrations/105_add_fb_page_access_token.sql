-- Migration: Add fb_page_access_token columns
-- Description: Stores Page Access Token for Lead Forms API (leads_retrieval permission)

-- Add to user_accounts (legacy)
ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS fb_page_access_token TEXT;

COMMENT ON COLUMN user_accounts.fb_page_access_token IS 'Facebook Page Access Token for Lead Forms API';

-- Add to ad_accounts (multi-account)
ALTER TABLE ad_accounts
ADD COLUMN IF NOT EXISTS fb_page_access_token TEXT;

COMMENT ON COLUMN ad_accounts.fb_page_access_token IS 'Facebook Page Access Token for Lead Forms API';
