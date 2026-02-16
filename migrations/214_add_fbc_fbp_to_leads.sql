-- 214: Add fbc/fbp columns for site CAPI attribution
-- fbc = Facebook Click Cookie (format: fb.1.{timestamp}.{fbclid}), NOT hashed
-- fbp = Facebook Browser Pixel cookie, NOT hashed

ALTER TABLE leads ADD COLUMN IF NOT EXISTS fbc TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fbp TEXT;
