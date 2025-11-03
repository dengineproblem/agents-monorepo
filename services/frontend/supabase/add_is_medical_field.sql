-- Add is_medical field to dialog_analysis table
ALTER TABLE dialog_analysis 
  ADD COLUMN IF NOT EXISTS is_medical BOOLEAN DEFAULT FALSE;

-- Add comment
COMMENT ON COLUMN dialog_analysis.is_medical IS 'Whether business is medical/healthcare related';

-- Index for filtering by medical niche
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_is_medical ON dialog_analysis(is_medical);
