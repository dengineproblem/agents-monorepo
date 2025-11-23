-- Migration: Add visual_style column to generated_creatives for carousel styling
-- Description: Stores the visual style used for carousel generation to maintain consistency during card regeneration

-- Add visual_style column for carousel creatives
ALTER TABLE generated_creatives
ADD COLUMN IF NOT EXISTS visual_style TEXT DEFAULT NULL
CHECK (visual_style IN ('clean_minimal', 'story_illustration', 'photo_ugc', 'asset_focus', NULL));

-- Add comment for the new column
COMMENT ON COLUMN generated_creatives.visual_style IS
'Visual style used for carousel generation. Values: clean_minimal, story_illustration, photo_ugc, asset_focus. Used only when creative_type=carousel. Defaults to clean_minimal if not specified.';

-- Create index for visual_style queries
CREATE INDEX IF NOT EXISTS idx_generated_creatives_visual_style ON generated_creatives(visual_style) WHERE visual_style IS NOT NULL;
