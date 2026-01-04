-- Migration: Merge WhatsApp Lead ID (LID) chats with real phone number chats
-- Problem: Messages from WhatsApp ads use Lead IDs (@lid) instead of real phone numbers,
--          causing the same conversation to appear as two separate chats.
-- Solution: Merge LID records into real phone records, then delete LID records.

-- Step 1: Create a mapping between LID and real phone numbers
CREATE TEMP TABLE lid_to_phone_mapping AS
WITH lid_records AS (
    SELECT DISTINCT
        contact_phone as lid,
        instance_name,
        MIN(created_at) as first_message
    FROM dialog_analysis
    WHERE LENGTH(REGEXP_REPLACE(contact_phone, '[^0-9]', '', 'g')) >= 15
      AND contact_phone IS NOT NULL
      AND instance_name IS NOT NULL
    GROUP BY contact_phone, instance_name
),
real_phone_records AS (
    SELECT DISTINCT
        contact_phone as real_phone,
        instance_name,
        MIN(created_at) as first_message
    FROM dialog_analysis
    WHERE LENGTH(REGEXP_REPLACE(contact_phone, '[^0-9]', '', 'g')) BETWEEN 10 AND 13
      AND contact_phone IS NOT NULL
      AND instance_name IS NOT NULL
    GROUP BY contact_phone, instance_name
)
SELECT
    l.lid,
    r.real_phone,
    l.instance_name
FROM lid_records l
JOIN real_phone_records r
    ON l.instance_name = r.instance_name
    AND ABS(EXTRACT(EPOCH FROM (l.first_message - r.first_message))) < 86400;

-- Step 2: Merge data from LID records into real phone records
-- Update counters, timestamps, and merge messages array
UPDATE dialog_analysis real_rec
SET
    -- Merge message counts
    incoming_count = real_rec.incoming_count + lid_rec.incoming_count,
    outgoing_count = real_rec.outgoing_count + lid_rec.outgoing_count,
    -- Use earliest first_message
    first_message = LEAST(real_rec.first_message, lid_rec.first_message),
    -- Use latest last_message
    last_message = GREATEST(real_rec.last_message, lid_rec.last_message),
    -- Merge messages arrays (LID messages + real phone messages, sorted by time)
    messages = (
        SELECT jsonb_agg(msg ORDER BY (msg->>'timestamp')::timestamptz)
        FROM (
            SELECT jsonb_array_elements(COALESCE(lid_rec.messages, '[]'::jsonb)) as msg
            UNION ALL
            SELECT jsonb_array_elements(COALESCE(real_rec.messages, '[]'::jsonb)) as msg
        ) combined
    ),
    -- Keep best analysis data (prefer non-null values)
    contact_name = COALESCE(real_rec.contact_name, lid_rec.contact_name),
    business_type = COALESCE(real_rec.business_type, lid_rec.business_type),
    is_owner = COALESCE(real_rec.is_owner, lid_rec.is_owner),
    uses_ads_now = COALESCE(real_rec.uses_ads_now, lid_rec.uses_ads_now),
    has_sales_dept = COALESCE(real_rec.has_sales_dept, lid_rec.has_sales_dept),
    has_booking = COALESCE(real_rec.has_booking, lid_rec.has_booking),
    sent_instagram = COALESCE(real_rec.sent_instagram, lid_rec.sent_instagram),
    interest_level = COALESCE(real_rec.interest_level, lid_rec.interest_level),
    main_intent = COALESCE(real_rec.main_intent, lid_rec.main_intent),
    objection = COALESCE(real_rec.objection, lid_rec.objection),
    score = COALESCE(real_rec.score, lid_rec.score),
    reasoning = COALESCE(real_rec.reasoning, lid_rec.reasoning),
    updated_at = NOW()
FROM dialog_analysis lid_rec
JOIN lid_to_phone_mapping m ON lid_rec.contact_phone = m.lid AND lid_rec.instance_name = m.instance_name
WHERE real_rec.contact_phone = m.real_phone
  AND real_rec.instance_name = m.instance_name;

-- Step 3: Delete LID records (now merged into real phone records)
DELETE FROM dialog_analysis
WHERE (contact_phone, instance_name) IN (
    SELECT lid, instance_name FROM lid_to_phone_mapping
);

-- Step 4: For LID records without matching real phone record, just clean up the phone
-- (remove the LID prefix, keep just digits - these are orphan LIDs)
UPDATE dialog_analysis
SET contact_phone = REGEXP_REPLACE(contact_phone, '[^0-9]', '', 'g')
WHERE LENGTH(REGEXP_REPLACE(contact_phone, '[^0-9]', '', 'g')) >= 15
  AND (contact_phone, instance_name) NOT IN (
      SELECT lid, instance_name FROM lid_to_phone_mapping
  );

-- Clean up
DROP TABLE IF EXISTS lid_to_phone_mapping;
