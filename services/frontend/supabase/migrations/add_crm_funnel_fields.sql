-- Migration: Add CRM funnel fields to dialog_analysis
-- Date: 2025-11-13
-- Description: Add funnel_stage, qualification_complete, custom_fields for new CRM system

-- Add funnel_stage column with CHECK constraint
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS funnel_stage TEXT
CHECK (funnel_stage IN ('new_lead', 'not_qualified', 'qualified', 'consultation_booked', 'consultation_completed', 'deal_closed', 'deal_lost'))
DEFAULT 'new_lead';

-- Add qualification_complete column
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS qualification_complete BOOLEAN DEFAULT FALSE;

-- Add custom_fields column for flexible LLM-generated fields
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT NULL;

-- Update main_intent constraint to use new values
ALTER TABLE dialog_analysis
DROP CONSTRAINT IF EXISTS dialog_analysis_main_intent_check;

ALTER TABLE dialog_analysis
ADD CONSTRAINT dialog_analysis_main_intent_check
CHECK (main_intent IN ('purchase', 'inquiry', 'support', 'consultation', 'other'));

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_funnel_stage ON dialog_analysis(funnel_stage);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_qualification ON dialog_analysis(qualification_complete);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_custom_fields ON dialog_analysis USING GIN (custom_fields);

-- Add comments for documentation
COMMENT ON COLUMN dialog_analysis.funnel_stage IS 'CRM funnel stage: new_lead, not_qualified, qualified, consultation_booked, consultation_completed, deal_closed, deal_lost';
COMMENT ON COLUMN dialog_analysis.qualification_complete IS 'Whether lead qualification is complete';
COMMENT ON COLUMN dialog_analysis.custom_fields IS 'Flexible JSONB field for additional LLM-generated data';
