-- Migration: Remove CTA from image constraint
-- Description: CTA is no longer required for image creatives since Facebook adds the button automatically

-- Drop the old constraint
ALTER TABLE generated_creatives
DROP CONSTRAINT IF EXISTS check_image_fields;

-- Add updated constraint without CTA requirement
ALTER TABLE generated_creatives
ADD CONSTRAINT check_image_fields
CHECK (
  creative_type != 'image' OR (
    offer IS NOT NULL AND
    bullets IS NOT NULL AND
    profits IS NOT NULL AND
    image_url IS NOT NULL
  )
);

COMMENT ON CONSTRAINT check_image_fields ON generated_creatives IS
'For image type: offer, bullets, profits, and image_url must be present. CTA is optional (Facebook adds button automatically).';
