-- Migration 129: Add direction_id to dialog_analysis
-- Description: Direct link from dialog_analysis to account_directions for easier filtering
-- Date: 2025-12-28

-- ============================================
-- 1. Add direction_id column
-- ============================================
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL;

COMMENT ON COLUMN dialog_analysis.direction_id IS 'Direct reference to direction for filtering dialogs by direction';

-- Index for faster filtering by direction
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_direction_id ON dialog_analysis(direction_id);

-- ============================================
-- 2. Migrate existing data
-- ============================================
-- Link dialogs to directions through instance_name -> whatsapp_phone_numbers
UPDATE dialog_analysis da
SET direction_id = wpn.direction_id
FROM whatsapp_phone_numbers wpn
WHERE da.instance_name = wpn.instance_name
  AND da.direction_id IS NULL
  AND wpn.direction_id IS NOT NULL;

-- ============================================
-- 3. Create trigger for future dialogs
-- ============================================
-- This trigger will automatically set direction_id when dialog is created/updated
CREATE OR REPLACE FUNCTION set_dialog_direction_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Only set if direction_id is NULL and instance_name is provided
  IF NEW.direction_id IS NULL AND NEW.instance_name IS NOT NULL THEN
    SELECT direction_id INTO NEW.direction_id
    FROM whatsapp_phone_numbers
    WHERE instance_name = NEW.instance_name
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to recreate
DROP TRIGGER IF EXISTS trg_set_dialog_direction_id ON dialog_analysis;

CREATE TRIGGER trg_set_dialog_direction_id
BEFORE INSERT OR UPDATE OF instance_name ON dialog_analysis
FOR EACH ROW
EXECUTE FUNCTION set_dialog_direction_id();
