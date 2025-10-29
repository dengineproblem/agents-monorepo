-- Migration 013: Add direction_id, creative_id, whatsapp_phone_number_id, user_account_id to leads table
-- This enables tracking which direction and creative each lead came from
-- and links leads to the new whatsapp_phone_numbers architecture

-- Add new columns to leads table
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS creative_id UUID REFERENCES user_creatives(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id UUID REFERENCES whatsapp_phone_numbers(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_leads_direction_id ON leads(direction_id);
CREATE INDEX IF NOT EXISTS idx_leads_creative_id ON leads(creative_id);
CREATE INDEX IF NOT EXISTS idx_leads_whatsapp_phone_number_id ON leads(whatsapp_phone_number_id);
CREATE INDEX IF NOT EXISTS idx_leads_user_account_id ON leads(user_account_id);
CREATE INDEX IF NOT EXISTS idx_leads_source_id ON leads(source_id);
CREATE INDEX IF NOT EXISTS idx_leads_chat_id ON leads(chat_id);

-- Add comment explaining the new architecture
COMMENT ON COLUMN leads.direction_id IS 'References account_directions - which marketing direction this lead came from';
COMMENT ON COLUMN leads.creative_id IS 'References user_creatives - which creative asset attracted this lead';
COMMENT ON COLUMN leads.whatsapp_phone_number_id IS 'References whatsapp_phone_numbers - which WhatsApp number received this lead message';
COMMENT ON COLUMN leads.user_account_id IS 'References user_accounts - the user who owns this lead';
COMMENT ON COLUMN leads.source_id IS 'Facebook Ad ID from WhatsApp message metadata';

-- Create or replace trigger function for updating updated_at
CREATE OR REPLACE FUNCTION update_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_leads_updated_at ON leads;
CREATE TRIGGER trigger_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW
EXECUTE FUNCTION update_leads_updated_at();
