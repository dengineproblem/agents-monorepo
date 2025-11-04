-- Migration: Add CRM-related fields to dialog_analysis table
-- Date: 2025-11-03
-- Description: Add fields for WhatsApp CRM functionality (funnel stages, qualification, notes)

-- Add missing fields for CRM functionality
ALTER TABLE dialog_analysis 
  ADD COLUMN IF NOT EXISTS ad_budget TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS funnel_stage TEXT CHECK (funnel_stage IN ('new_lead', 'not_qualified', 'qualified', 'consultation_booked', 'consultation_completed', 'deal_closed', 'deal_lost')),
  ADD COLUMN IF NOT EXISTS qualification_complete BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add comments
COMMENT ON COLUMN dialog_analysis.ad_budget IS 'Advertising budget range (e.g., "50-100k/month")';
COMMENT ON COLUMN dialog_analysis.instagram_url IS 'Instagram profile URL';
COMMENT ON COLUMN dialog_analysis.funnel_stage IS 'Current stage in sales funnel';
COMMENT ON COLUMN dialog_analysis.qualification_complete IS 'Whether lead qualification is complete (4 key questions answered)';
COMMENT ON COLUMN dialog_analysis.notes IS 'Manual notes by sales manager';

-- Create indexes for frequently queried fields
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_funnel_stage ON dialog_analysis(funnel_stage);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_qualification ON dialog_analysis(qualification_complete);

-- Set default funnel_stage for existing records (if null, set to 'new_lead')
UPDATE dialog_analysis 
SET funnel_stage = 'new_lead' 
WHERE funnel_stage IS NULL;

