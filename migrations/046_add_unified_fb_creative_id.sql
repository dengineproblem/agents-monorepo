-- Migration: Add unified fb_creative_id to user_creatives
-- Description: Standardizes creative storage - one creative = one objective
-- The old fields (fb_creative_id_whatsapp, fb_creative_id_instagram_traffic, fb_creative_id_site_leads)
-- are kept for backward compatibility but marked as deprecated

-- 1. Add new unified field
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS fb_creative_id TEXT;

-- 2. Add comment explaining the new approach
COMMENT ON COLUMN user_creatives.fb_creative_id IS 'Единый FB Creative ID. Креатив создаётся для одного objective из связанного direction.';

-- 3. Mark old fields as deprecated (via comments)
COMMENT ON COLUMN user_creatives.fb_creative_id_whatsapp IS 'DEPRECATED: Use fb_creative_id instead. Facebook Creative ID for WhatsApp objective.';
COMMENT ON COLUMN user_creatives.fb_creative_id_instagram_traffic IS 'DEPRECATED: Use fb_creative_id instead. Facebook Creative ID for Instagram Traffic objective.';
COMMENT ON COLUMN user_creatives.fb_creative_id_site_leads IS 'DEPRECATED: Use fb_creative_id instead. Facebook Creative ID for Site Leads objective.';

-- 4. Migrate existing data - copy from the appropriate old field based on direction objective
-- This will be done in a separate step after code changes are deployed
