-- Migration 020: Bizon365 Integration
-- Description: Add Bizon365 webinar integration for cross-analytics with ad leads
-- Date: 2025-11-01

-- =====================================================
-- 1. Add Bizon API token field to user_accounts
-- =====================================================

ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS bizon_api_token TEXT;

COMMENT ON COLUMN user_accounts.bizon_api_token IS 'Individual API token for Bizon365 webinar platform';

-- =====================================================
-- 2. Create webinar_attendees table
-- =====================================================

CREATE TABLE IF NOT EXISTS webinar_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Webinar identification
  webinar_id TEXT NOT NULL,
  webinar_title TEXT,
  webinar_date TIMESTAMPTZ,
  
  -- Relations
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Attendee information
  phone_number TEXT NOT NULL,
  username TEXT,
  email TEXT,
  
  -- Attendance metrics
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  watch_duration_sec INTEGER,
  attended BOOLEAN DEFAULT true,
  
  -- UTM tracking
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  url_marker TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. Create indexes for performance
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_webinar_attendees_lead ON webinar_attendees(lead_id);
CREATE INDEX IF NOT EXISTS idx_webinar_attendees_user ON webinar_attendees(user_account_id);
CREATE INDEX IF NOT EXISTS idx_webinar_attendees_webinar ON webinar_attendees(webinar_id);
CREATE INDEX IF NOT EXISTS idx_webinar_attendees_phone ON webinar_attendees(phone_number);
CREATE INDEX IF NOT EXISTS idx_webinar_attendees_date ON webinar_attendees(webinar_date DESC);

-- =====================================================
-- 4. Add RLS policies for multi-tenancy
-- =====================================================

ALTER TABLE webinar_attendees ENABLE ROW LEVEL SECURITY;

-- Users can only see their own webinar attendees
CREATE POLICY "Users can view own webinar attendees"
  ON webinar_attendees
  FOR SELECT
  USING (user_account_id = auth.uid());

-- Users can only insert their own webinar attendees
CREATE POLICY "Users can insert own webinar attendees"
  ON webinar_attendees
  FOR INSERT
  WITH CHECK (user_account_id = auth.uid());

-- Users can only update their own webinar attendees
CREATE POLICY "Users can update own webinar attendees"
  ON webinar_attendees
  FOR UPDATE
  USING (user_account_id = auth.uid());

-- Users can only delete their own webinar attendees
CREATE POLICY "Users can delete own webinar attendees"
  ON webinar_attendees
  FOR DELETE
  USING (user_account_id = auth.uid());

-- Service role has full access
CREATE POLICY "Service role has full access to webinar_attendees"
  ON webinar_attendees
  FOR ALL
  USING (auth.role() = 'service_role');

-- =====================================================
-- 5. Add comments for documentation
-- =====================================================

COMMENT ON TABLE webinar_attendees IS 'Stores webinar attendance data from Bizon365, linked to leads for cross-analytics';
COMMENT ON COLUMN webinar_attendees.webinar_id IS 'Bizon365 webinar ID';
COMMENT ON COLUMN webinar_attendees.lead_id IS 'Reference to lead from advertising (nullable if lead not found)';
COMMENT ON COLUMN webinar_attendees.phone_number IS 'Normalized phone number for matching with leads';
COMMENT ON COLUMN webinar_attendees.watch_duration_sec IS 'Total watch duration in seconds';
COMMENT ON COLUMN webinar_attendees.attended IS 'True if user actually attended (watch_duration > 0)';
COMMENT ON COLUMN webinar_attendees.url_marker IS 'Partner/affiliate marker from Bizon365';

