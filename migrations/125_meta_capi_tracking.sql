-- Migration 125: Meta Conversions API (CAPI) tracking
-- Description: Add ctwa_clid to leads and CAPI event tracking flags to dialog_analysis
-- Date: 2025-12-25

-- ============================================
-- 1. Add ctwa_clid to leads table
-- ============================================
-- ctwa_clid is Click-to-WhatsApp Click ID from Facebook ads
-- Used for conversion attribution in Meta Conversions API

ALTER TABLE leads ADD COLUMN IF NOT EXISTS ctwa_clid TEXT;

COMMENT ON COLUMN leads.ctwa_clid IS 'Click-to-WhatsApp Click ID from Facebook ads for CAPI attribution';

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_leads_ctwa_clid ON leads(ctwa_clid) WHERE ctwa_clid IS NOT NULL;

-- ============================================
-- 2. Add CAPI tracking flags to dialog_analysis
-- ============================================
-- Three levels of conversion events:
-- Level 1 (Interest): Client sent 2+ messages
-- Level 2 (Qualified): Client answered all qualification questions correctly
-- Level 3 (Scheduled): Client booked an appointment/consultation

-- Flags to track if event was sent to CAPI (to avoid duplicates)
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_interest_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_qualified_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_scheduled_sent BOOLEAN DEFAULT FALSE;

-- Timestamps when events were sent
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_interest_sent_at TIMESTAMPTZ;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_qualified_sent_at TIMESTAMPTZ;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_scheduled_sent_at TIMESTAMPTZ;

-- Event IDs returned by CAPI (for debugging/audit)
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_interest_event_id TEXT;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_qualified_event_id TEXT;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_scheduled_event_id TEXT;

-- Qualification analysis result from LLM
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS qualification_result JSONB;

COMMENT ON COLUMN dialog_analysis.capi_interest_sent IS 'Whether Lead event (interest) was sent to Meta CAPI';
COMMENT ON COLUMN dialog_analysis.capi_qualified_sent IS 'Whether CompleteRegistration event (qualified) was sent to Meta CAPI';
COMMENT ON COLUMN dialog_analysis.capi_scheduled_sent IS 'Whether Schedule event (appointment booked) was sent to Meta CAPI';
COMMENT ON COLUMN dialog_analysis.qualification_result IS 'LLM analysis result: {is_interested, is_qualified, is_scheduled, reasoning}';

-- Indexes for CAPI event queries
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_capi_interest ON dialog_analysis(capi_interest_sent) WHERE capi_interest_sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_capi_qualified ON dialog_analysis(capi_qualified_sent) WHERE capi_qualified_sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_capi_scheduled ON dialog_analysis(capi_scheduled_sent) WHERE capi_scheduled_sent = FALSE;

-- ============================================
-- 3. Add ctwa_clid to dialog_analysis for easy access
-- ============================================
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS ctwa_clid TEXT;

COMMENT ON COLUMN dialog_analysis.ctwa_clid IS 'Click-to-WhatsApp Click ID copied from leads for CAPI';

-- ============================================
-- 4. Create capi_events_log table for audit trail
-- ============================================
CREATE TABLE IF NOT EXISTS capi_events_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to dialog
  dialog_analysis_id UUID REFERENCES dialog_analysis(id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,

  -- User context
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL,

  -- Event details
  event_name TEXT NOT NULL, -- 'Lead', 'CompleteRegistration', 'Schedule'
  event_level INT NOT NULL CHECK (event_level IN (1, 2, 3)), -- 1=interest, 2=qualified, 3=scheduled

  -- CAPI request/response
  pixel_id TEXT NOT NULL,
  ctwa_clid TEXT,
  event_time TIMESTAMPTZ NOT NULL,
  event_id TEXT, -- Unique event ID for deduplication

  -- CAPI response
  capi_response JSONB,
  capi_status TEXT, -- 'success', 'error', 'skipped'
  capi_error TEXT,

  -- Phone for hashing (stored temporarily, should be hashed before sending)
  contact_phone TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_capi_events_log_user_account ON capi_events_log(user_account_id);
CREATE INDEX IF NOT EXISTS idx_capi_events_log_dialog ON capi_events_log(dialog_analysis_id);
CREATE INDEX IF NOT EXISTS idx_capi_events_log_event_name ON capi_events_log(event_name);
CREATE INDEX IF NOT EXISTS idx_capi_events_log_created_at ON capi_events_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capi_events_log_status ON capi_events_log(capi_status);

COMMENT ON TABLE capi_events_log IS 'Audit log of all Meta Conversions API events sent';
COMMENT ON COLUMN capi_events_log.event_level IS '1=Interest (2+ messages), 2=Qualified (passed qualification), 3=Scheduled (booked appointment)';

-- ============================================
-- 5. RLS Policies for capi_events_log
-- ============================================
ALTER TABLE capi_events_log ENABLE ROW LEVEL SECURITY;

-- Policy for users to see their own events
CREATE POLICY "Users can view own capi_events" ON capi_events_log
  FOR SELECT USING (user_account_id = auth.uid());

-- Policy for service role (full access)
CREATE POLICY "Service role full access to capi_events" ON capi_events_log
  FOR ALL USING (auth.role() = 'service_role');
