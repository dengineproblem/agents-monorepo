-- Migration: Add structured funnel stages and key stages to business_profile
-- Date: 2025-11-14
-- Description: Store user-defined funnel stages in structured format with key stage markers

-- Add structured funnel stages fields
ALTER TABLE business_profile 
  ADD COLUMN IF NOT EXISTS funnel_stages_structured JSONB,
  ADD COLUMN IF NOT EXISTS key_funnel_stages TEXT[];

-- Comments
COMMENT ON COLUMN business_profile.funnel_stages_structured IS 
  'Structured funnel stages: [{"id": "1", "name": "Первый контакт", "order": 1}, ...]';
COMMENT ON COLUMN business_profile.key_funnel_stages IS 
  'Array of key stage names where leads should not be disturbed (e.g., ["Запись на консультацию", "Ожидание визита"])';

-- Create index for key stages lookup
CREATE INDEX IF NOT EXISTS idx_business_profile_key_stages 
  ON business_profile USING GIN (key_funnel_stages);



