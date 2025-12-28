-- Migration 128: Add CAPI metrics to conversation reports
-- Description: Add capi_distribution to show CAPI funnel instead of hot/warm/cold when pixel is connected
-- Date: 2025-12-28

-- Add CAPI distribution field
-- Stores: { interest: N, qualified: N, scheduled: N }
ALTER TABLE conversation_reports
ADD COLUMN IF NOT EXISTS capi_distribution JSONB DEFAULT '{}'::jsonb;

-- Flag to indicate if CAPI data was used for this report
ALTER TABLE conversation_reports
ADD COLUMN IF NOT EXISTS capi_source_used BOOLEAN DEFAULT FALSE;

-- Flag to indicate if CAPI has actual data (at least one event)
-- Used to show fallback to hot/warm/cold when CAPI is enabled but no events yet
ALTER TABLE conversation_reports
ADD COLUMN IF NOT EXISTS capi_has_data BOOLEAN DEFAULT FALSE;

-- Direction ID that was used for CAPI (for reference)
ALTER TABLE conversation_reports
ADD COLUMN IF NOT EXISTS capi_direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL;

COMMENT ON COLUMN conversation_reports.capi_distribution IS 'CAPI funnel metrics: {interest: N (Lead events), qualified: N (CompleteRegistration), scheduled: N (Schedule)}';
COMMENT ON COLUMN conversation_reports.capi_source_used IS 'Whether CAPI is enabled for the direction (true) or not (false)';
COMMENT ON COLUMN conversation_reports.capi_has_data IS 'Whether there is at least one CAPI event. If false and capi_source_used=true, shows fallback to hot/warm/cold';
COMMENT ON COLUMN conversation_reports.capi_direction_id IS 'Reference to direction with CAPI enabled that was used for metrics';
