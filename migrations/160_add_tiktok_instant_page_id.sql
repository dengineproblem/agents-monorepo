-- Migration: Add tiktok_instant_page_id to account_directions
-- TikTok Instant Pages are used for Lead Generation campaigns

ALTER TABLE account_directions
ADD COLUMN IF NOT EXISTS tiktok_instant_page_id TEXT;

COMMENT ON COLUMN account_directions.tiktok_instant_page_id IS 'TikTok Instant Page ID for Lead Generation campaigns';
