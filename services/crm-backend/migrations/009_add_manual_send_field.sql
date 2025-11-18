-- Migration: Add manual send support for campaign messages
-- This allows users to manually trigger queue sending with smart scheduling

-- Add field to track manual send requests
ALTER TABLE campaign_messages 
ADD COLUMN IF NOT EXISTS manual_send_requested_at TIMESTAMPTZ NULL;

-- Add index for efficient querying of manual send requests
CREATE INDEX IF NOT EXISTS idx_campaign_messages_manual_send 
ON campaign_messages(user_account_id, manual_send_requested_at) 
WHERE manual_send_requested_at IS NOT NULL;

-- Add index for pending/scheduled messages
CREATE INDEX IF NOT EXISTS idx_campaign_messages_status_user 
ON campaign_messages(user_account_id, status, created_at);

COMMENT ON COLUMN campaign_messages.manual_send_requested_at IS 
'Timestamp when user manually requested to send this queue. Used to prioritize manual sends over autopilot.';

