-- Migration: Add key stage tracking to dialog_analysis
-- Date: 2025-11-14
-- Description: Track when leads enter/leave key funnel stages for campaign queue filtering

-- Add key stage tracking fields
ALTER TABLE dialog_analysis
  ADD COLUMN IF NOT EXISTS is_on_key_stage BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS key_stage_entered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS key_stage_left_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS funnel_stage_history JSONB DEFAULT '[]'::jsonb;

-- Comments
COMMENT ON COLUMN dialog_analysis.is_on_key_stage IS 
  'Whether lead is currently on a key funnel stage (e.g., appointment booked)';
COMMENT ON COLUMN dialog_analysis.key_stage_entered_at IS 
  'Timestamp when lead entered current key stage';
COMMENT ON COLUMN dialog_analysis.key_stage_left_at IS 
  'Timestamp when lead left last key stage';
COMMENT ON COLUMN dialog_analysis.funnel_stage_history IS 
  'History of funnel stage changes: [{"stage": "qualified", "timestamp": "2025-11-14T10:00:00Z"}, ...]';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_key_stage 
  ON dialog_analysis(is_on_key_stage) 
  WHERE is_on_key_stage = TRUE;

CREATE INDEX IF NOT EXISTS idx_dialog_analysis_key_stage_left 
  ON dialog_analysis(key_stage_left_at) 
  WHERE key_stage_left_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dialog_analysis_funnel_stage_history 
  ON dialog_analysis USING GIN (funnel_stage_history);



