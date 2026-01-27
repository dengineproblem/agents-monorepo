-- Migration 162: Add source field to user_creatives
-- Created: 2026-01-27
-- Description: Track creative source (uploaded vs imported from FB analysis)

-- Add source column to distinguish uploaded vs imported creatives
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'uploaded';

-- Add constraint for valid values
ALTER TABLE user_creatives
ADD CONSTRAINT user_creatives_source_check
CHECK (source IN ('uploaded', 'imported_analysis'));

-- Add fb_ad_id to track original Facebook ad for imported creatives
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS fb_ad_id TEXT;

-- Add imported_cpl_cents to store CPL at import time
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS imported_cpl_cents INTEGER;

-- Add imported_leads to store leads count at import time
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS imported_leads INTEGER;

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_user_creatives_source ON user_creatives(source);

-- Comment
COMMENT ON COLUMN user_creatives.source IS 'Creative source: uploaded (user upload) or imported_analysis (imported from FB top creatives)';
COMMENT ON COLUMN user_creatives.fb_ad_id IS 'Original Facebook Ad ID for imported creatives';
COMMENT ON COLUMN user_creatives.imported_cpl_cents IS 'CPL in cents at the time of import';
COMMENT ON COLUMN user_creatives.imported_leads IS 'Number of leads at the time of import';
