-- Migration: Remove next_message field from dialog_analysis
-- This field was removed from the analysis logic, so we remove it from the database

ALTER TABLE dialog_analysis
DROP COLUMN IF EXISTS next_message;

-- Add a comment to document the change
COMMENT ON TABLE dialog_analysis IS 'Stores AI analysis results for WhatsApp dialogs. Updated to remove next_message field.';

