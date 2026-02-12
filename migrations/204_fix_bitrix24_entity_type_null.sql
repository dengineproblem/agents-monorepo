-- Fix leads that have bitrix24_deal_id or bitrix24_lead_id but missing bitrix24_entity_type
-- This was caused by facebookWebhooks.ts and bitrix24Sync.ts not setting the field

UPDATE leads
SET bitrix24_entity_type = 'deal'
WHERE bitrix24_deal_id IS NOT NULL
  AND bitrix24_entity_type IS NULL;

UPDATE leads
SET bitrix24_entity_type = 'lead'
WHERE bitrix24_lead_id IS NOT NULL
  AND bitrix24_deal_id IS NULL
  AND bitrix24_entity_type IS NULL;
