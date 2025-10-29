-- Migration 016: Migrate existing leads data to new architecture
-- This script attempts to populate the new fields (direction_id, creative_id, etc.) for existing leads
-- based on available data (business_id, creative_url, source_id)

-- Step 1: Fill whatsapp_phone_number_id by matching business_id to phone_number
-- This links old leads to the new whatsapp_phone_numbers table
UPDATE leads l
SET whatsapp_phone_number_id = wpn.id
FROM whatsapp_phone_numbers wpn
WHERE l.business_id = wpn.phone_number
  AND l.whatsapp_phone_number_id IS NULL;

-- Step 2: Try to fill user_account_id from whatsapp_phone_number_id
-- This establishes user ownership of leads
UPDATE leads l
SET user_account_id = wpn.user_account_id
FROM whatsapp_phone_numbers wpn
WHERE l.whatsapp_phone_number_id = wpn.id
  AND l.user_account_id IS NULL;

-- Step 3: Try to match creative by creative_url (Instagram posts)
-- Match leads to creatives based on Instagram post URLs
UPDATE leads l
SET creative_id = uc.id,
    direction_id = uc.direction_id
FROM user_creatives uc
WHERE l.creative_url IS NOT NULL
  AND uc.title ILIKE '%' || SUBSTRING(l.creative_url FROM '/(p|reel)/([A-Za-z0-9_-]+)') || '%'
  AND l.creative_id IS NULL
  AND uc.user_id = l.user_account_id;

-- Step 4: Alternative matching - try to find direction that uses WhatsApp objective
-- For leads with WhatsApp phone number, link to direction that uses that number
UPDATE leads l
SET direction_id = ad.id
FROM account_directions ad
WHERE l.whatsapp_phone_number_id = ad.whatsapp_phone_number_id
  AND ad.objective = 'whatsapp'
  AND l.direction_id IS NULL
  AND l.whatsapp_phone_number_id IS NOT NULL;

-- Step 5: Set direction_id from creative_id if available
-- If we found the creative but not the direction, get direction from creative
UPDATE leads l
SET direction_id = uc.direction_id
FROM user_creatives uc
WHERE l.creative_id = uc.id
  AND l.direction_id IS NULL
  AND uc.direction_id IS NOT NULL;

-- Report statistics
DO $$
DECLARE
    total_leads INTEGER;
    leads_with_direction INTEGER;
    leads_with_creative INTEGER;
    leads_with_whatsapp_number INTEGER;
    leads_with_user_account INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_leads FROM leads;
    SELECT COUNT(*) INTO leads_with_direction FROM leads WHERE direction_id IS NOT NULL;
    SELECT COUNT(*) INTO leads_with_creative FROM leads WHERE creative_id IS NOT NULL;
    SELECT COUNT(*) INTO leads_with_whatsapp_number FROM leads WHERE whatsapp_phone_number_id IS NOT NULL;
    SELECT COUNT(*) INTO leads_with_user_account FROM leads WHERE user_account_id IS NOT NULL;

    RAISE NOTICE 'Migration 016 Statistics:';
    RAISE NOTICE '  Total leads: %', total_leads;
    RAISE NOTICE '  Leads with direction_id: % (%.1f%%)',
        leads_with_direction,
        (leads_with_direction::FLOAT / NULLIF(total_leads, 0) * 100);
    RAISE NOTICE '  Leads with creative_id: % (%.1f%%)',
        leads_with_creative,
        (leads_with_creative::FLOAT / NULLIF(total_leads, 0) * 100);
    RAISE NOTICE '  Leads with whatsapp_phone_number_id: % (%.1f%%)',
        leads_with_whatsapp_number,
        (leads_with_whatsapp_number::FLOAT / NULLIF(total_leads, 0) * 100);
    RAISE NOTICE '  Leads with user_account_id: % (%.1f%%)',
        leads_with_user_account,
        (leads_with_user_account::FLOAT / NULLIF(total_leads, 0) * 100);
END $$;

-- Create a view for unmapped leads (for manual review)
CREATE OR REPLACE VIEW unmapped_leads AS
SELECT
    l.id,
    l.chat_id,
    l.source_id,
    l.creative_url,
    l.business_id,
    l.created_at,
    CASE
        WHEN l.direction_id IS NULL THEN 'Missing direction_id'
        WHEN l.creative_id IS NULL THEN 'Missing creative_id'
        WHEN l.whatsapp_phone_number_id IS NULL THEN 'Missing whatsapp_phone_number_id'
        WHEN l.user_account_id IS NULL THEN 'Missing user_account_id'
    END as missing_field
FROM leads l
WHERE l.direction_id IS NULL
   OR l.creative_id IS NULL
   OR l.whatsapp_phone_number_id IS NULL
   OR l.user_account_id IS NULL
ORDER BY l.created_at DESC;

COMMENT ON VIEW unmapped_leads IS 'Shows leads that could not be fully migrated to new architecture';
