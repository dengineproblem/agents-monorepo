-- Migration: Add carousel and video script support to generated_creatives
-- Description: Extends generated_creatives table to support multiple creative types

-- Add creative_type column
ALTER TABLE generated_creatives
ADD COLUMN IF NOT EXISTS creative_type TEXT NOT NULL DEFAULT 'image'
CHECK (creative_type IN ('image', 'carousel', 'video_script'));

-- Add carousel_data column for storing carousel cards
-- This will be a JSONB array of carousel cards, each containing:
-- {
--   "order": 1,
--   "text": "текст карточки",
--   "image_url": "url 2K версии",
--   "image_url_4k": "url 4K версии",
--   "custom_prompt": "дополнительный промпт пользователя",
--   "reference_image_url": "url референсного изображения для этой карточки"
-- }
ALTER TABLE generated_creatives
ADD COLUMN IF NOT EXISTS carousel_data JSONB DEFAULT NULL;

-- Add video_script_data column for storing video script information (future use)
-- This will store video script details when implemented
ALTER TABLE generated_creatives
ADD COLUMN IF NOT EXISTS video_script_data JSONB DEFAULT NULL;

-- Make existing text fields nullable for carousel/video types
-- For carousel, texts are stored in carousel_data
-- For video scripts, texts are stored in video_script_data
ALTER TABLE generated_creatives
ALTER COLUMN offer DROP NOT NULL,
ALTER COLUMN bullets DROP NOT NULL,
ALTER COLUMN profits DROP NOT NULL,
ALTER COLUMN cta DROP NOT NULL,
ALTER COLUMN image_url DROP NOT NULL;

-- Add constraint: for image type, all text fields must be present
ALTER TABLE generated_creatives
ADD CONSTRAINT check_image_fields
CHECK (
  creative_type != 'image' OR (
    offer IS NOT NULL AND
    bullets IS NOT NULL AND
    profits IS NOT NULL AND
    cta IS NOT NULL AND
    image_url IS NOT NULL
  )
);

-- Add constraint: for carousel type, carousel_data must be present
ALTER TABLE generated_creatives
ADD CONSTRAINT check_carousel_fields
CHECK (
  creative_type != 'carousel' OR carousel_data IS NOT NULL
);

-- Add constraint: for video_script type, video_script_data must be present
ALTER TABLE generated_creatives
ADD CONSTRAINT check_video_script_fields
CHECK (
  creative_type != 'video_script' OR video_script_data IS NOT NULL
);

-- Create index for creative_type queries
CREATE INDEX IF NOT EXISTS idx_generated_creatives_creative_type ON generated_creatives(creative_type);

-- Create composite index for user queries by type
CREATE INDEX IF NOT EXISTS idx_generated_creatives_user_type ON generated_creatives(user_id, creative_type);

-- Add comments for new columns
COMMENT ON COLUMN generated_creatives.creative_type IS
'Type of creative: image (single image), carousel (multiple images with storytelling), video_script (video scenario/script)';

COMMENT ON COLUMN generated_creatives.carousel_data IS
'JSONB array of carousel cards. Each card: {order, text, image_url, image_url_4k, custom_prompt, reference_image_url}. Used only when creative_type=carousel.';

COMMENT ON COLUMN generated_creatives.video_script_data IS
'JSONB object containing video script data (scenes, voiceover, timing, etc.). Used only when creative_type=video_script. Format TBD.';

-- Update table comment
COMMENT ON TABLE generated_creatives IS
'AI-generated creatives (Gemini 3 Pro) - supports images, carousels, and video scripts. Промежуточное хранение до загрузки на Facebook. После загрузки на FB креатив копируется в user_creatives с FB IDs.';
