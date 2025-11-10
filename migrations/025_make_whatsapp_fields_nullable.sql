-- Migration 025: Make WhatsApp-specific fields nullable
-- Description: Allow NULL values for chat_id and business_id for website/manual leads
-- Date: 2025-11-04

-- ============================================================================
-- 1. Make chat_id and business_id nullable
-- ============================================================================

ALTER TABLE leads 
  ALTER COLUMN chat_id DROP NOT NULL,
  ALTER COLUMN business_id DROP NOT NULL;

COMMENT ON COLUMN leads.chat_id IS 'WhatsApp chat ID (phone@s.whatsapp.net or phone@c.us) - only for WhatsApp leads, NULL for website/manual leads';
COMMENT ON COLUMN leads.business_id IS 'WhatsApp Business ID - only for WhatsApp leads, NULL for website/manual leads';

-- ============================================================================
-- 2. Update existing data (if needed)
-- ============================================================================

-- Set source_type for existing WhatsApp leads
UPDATE leads
SET source_type = 'whatsapp'
WHERE chat_id IS NOT NULL 
  AND source_type IS NULL;

-- ============================================================================
-- 3. Verify constraint exists
-- ============================================================================

-- The constraint from migration 024 should ensure at least one contact method exists:
-- CHECK (chat_id IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL)



