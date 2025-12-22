-- Migration: Add creative gallery and drafts support
-- Description: Adds is_draft flag for saving drafts, indexes for gallery queries

-- Add is_draft column to generated_creatives
ALTER TABLE generated_creatives
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false;

-- Add index for drafts query (user's drafts)
CREATE INDEX IF NOT EXISTS idx_generated_creatives_user_drafts
ON generated_creatives(user_id, is_draft) WHERE is_draft = true;

-- Add index for gallery by style (for image creatives)
CREATE INDEX IF NOT EXISTS idx_generated_creatives_style_gallery
ON generated_creatives(style_id, created_at DESC)
WHERE style_id IS NOT NULL AND is_draft = false;

-- Add index for gallery by visual_style (for carousel creatives)
CREATE INDEX IF NOT EXISTS idx_generated_creatives_visual_style_gallery
ON generated_creatives(visual_style, created_at DESC)
WHERE visual_style IS NOT NULL AND is_draft = false;

-- Add index for creative_type filtering
CREATE INDEX IF NOT EXISTS idx_generated_creatives_type
ON generated_creatives(creative_type, created_at DESC);

-- Add composite index for user history with type
CREATE INDEX IF NOT EXISTS idx_generated_creatives_user_type_history
ON generated_creatives(user_id, creative_type, created_at DESC);

-- Update RLS policy to allow viewing all non-draft creatives for gallery
-- First drop existing SELECT policy if exists, then create new one
DROP POLICY IF EXISTS "Users can view their own generated creatives" ON generated_creatives;
DROP POLICY IF EXISTS "Users can view gallery creatives" ON generated_creatives;

-- Policy: Users can view their own creatives (including drafts) OR non-draft creatives from others (gallery)
CREATE POLICY "Users can view their own or public creatives"
    ON generated_creatives
    FOR SELECT
    USING (
        auth.uid() = user_id  -- Own creatives
        OR is_draft = false   -- Public gallery (non-drafts)
    );

-- Add index for text_generation_history gallery queries
CREATE INDEX IF NOT EXISTS idx_text_gen_history_type_gallery
ON text_generation_history(text_type, created_at DESC);

-- Enable RLS on text_generation_history if not enabled
ALTER TABLE text_generation_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate them
DROP POLICY IF EXISTS "Users can view their own text generations" ON text_generation_history;
DROP POLICY IF EXISTS "Users can view all text generations" ON text_generation_history;
DROP POLICY IF EXISTS "Users can insert their own text generations" ON text_generation_history;

-- Policy: All authenticated users can view all text generations (for gallery)
CREATE POLICY "Users can view all text generations"
    ON text_generation_history
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Users can only insert their own text generations
CREATE POLICY "Users can insert their own text generations"
    ON text_generation_history
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Add 'reference' type to text_type check constraint if not exists
-- First drop the old constraint, then add new one with 'reference' included
ALTER TABLE text_generation_history DROP CONSTRAINT IF EXISTS text_generation_history_text_type_check;
ALTER TABLE text_generation_history ADD CONSTRAINT text_generation_history_text_type_check
    CHECK (text_type IN ('storytelling', 'direct_offer', 'expert_video', 'telegram_post', 'threads_post', 'reference'));

-- Comments
COMMENT ON COLUMN generated_creatives.is_draft IS 'True if creative is a draft (not published to Facebook), can be edited later';
