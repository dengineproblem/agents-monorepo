-- Migration 024: Add Website Lead Fields
-- Description: Add fields for website leads (name, phone, email)
-- Date: 2025-11-04

-- ============================================================================
-- 1. Add fields for website leads
-- ============================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'whatsapp' CHECK (source_type IN ('whatsapp', 'website', 'manual'));

-- Note: chat_id is already nullable in the original table definition

COMMENT ON COLUMN leads.name IS 'Lead name from website form or WhatsApp contact';
COMMENT ON COLUMN leads.phone IS 'Phone number in original format (e.g., +7 912 345-67-89)';
COMMENT ON COLUMN leads.email IS 'Email address from website form';
COMMENT ON COLUMN leads.message IS 'Message or comment from lead';
COMMENT ON COLUMN leads.source_type IS 'Source of the lead: whatsapp (from WhatsApp messages), website (from website forms), manual (manually created)';
COMMENT ON COLUMN leads.chat_id IS 'WhatsApp chat ID (phone@s.whatsapp.net) - only for WhatsApp leads';

-- Create indexes for searching by phone and email
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_source_type ON leads(source_type);

-- ============================================================================
-- 2. Update existing WhatsApp leads to have source_type = 'whatsapp'
-- ============================================================================

UPDATE leads
SET source_type = 'whatsapp'
WHERE chat_id IS NOT NULL AND source_type IS NULL;

-- ============================================================================
-- 3. Add constraint: either chat_id OR phone OR email must be present
-- ============================================================================

-- Drop existing constraint if it exists
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'leads_contact_info_check'
  ) THEN
    ALTER TABLE leads DROP CONSTRAINT leads_contact_info_check;
  END IF;
END $$;

-- Add a check constraint to ensure we have at least one way to contact the lead
ALTER TABLE leads
  ADD CONSTRAINT leads_contact_info_check 
  CHECK (
    chat_id IS NOT NULL OR 
    phone IS NOT NULL OR 
    email IS NOT NULL
  );

COMMENT ON CONSTRAINT leads_contact_info_check ON leads IS 'Ensure at least one contact method is provided (chat_id, phone, or email)';

