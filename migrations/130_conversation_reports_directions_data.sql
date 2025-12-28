-- Migration 130: Add directions_data to conversation_reports
-- Description: Store per-direction metrics in reports for multi-direction support
-- Date: 2025-12-28

-- ============================================
-- 1. Add directions_data JSONB column
-- ============================================
-- This replaces the single capi_direction_id approach with full per-direction data
ALTER TABLE conversation_reports
ADD COLUMN IF NOT EXISTS directions_data JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN conversation_reports.directions_data IS 'Per-direction metrics array. Structure: [{direction_id, direction_name, total_dialogs, capi_enabled, capi_has_data, capi_distribution: {interest, qualified, scheduled}, interest_distribution: {hot, warm, cold}, incoming_messages, outgoing_messages}]';

-- ============================================
-- 2. Keep legacy fields for backwards compatibility
-- ============================================
-- The existing fields (capi_distribution, capi_source_used, capi_has_data, capi_direction_id)
-- from migration 128 are kept for backwards compatibility with existing reports.
-- New reports will populate both the legacy fields (with aggregated/first direction data)
-- and the new directions_data array (with per-direction breakdown).

-- ============================================
-- 3. Add index for querying reports with directions data
-- ============================================
-- GIN index for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_conversation_reports_directions_data
ON conversation_reports USING GIN (directions_data);
