-- Migration: Add fb_creative_id_lead_forms column to user_creatives
-- Description: Adds column for storing Facebook Creative ID for lead forms objective

ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS fb_creative_id_lead_forms TEXT;

COMMENT ON COLUMN user_creatives.fb_creative_id_lead_forms IS 'Facebook Creative ID for Lead Forms objective';
