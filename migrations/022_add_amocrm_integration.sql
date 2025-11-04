-- Migration 022: Add AmoCRM Integration
-- This migration adds AmoCRM integration support for lead management and sales tracking

-- ============================================================================
-- 1. Add AmoCRM OAuth tokens to user_accounts
-- ============================================================================

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS amocrm_subdomain TEXT,
  ADD COLUMN IF NOT EXISTS amocrm_access_token TEXT,
  ADD COLUMN IF NOT EXISTS amocrm_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS amocrm_token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN user_accounts.amocrm_subdomain IS 'AmoCRM subdomain (e.g., "amo" from amo.performanteaiagency.com or "example" from example.amocrm.ru)';
COMMENT ON COLUMN user_accounts.amocrm_access_token IS 'AmoCRM OAuth access token (encrypted in application layer)';
COMMENT ON COLUMN user_accounts.amocrm_refresh_token IS 'AmoCRM OAuth refresh token (encrypted in application layer)';
COMMENT ON COLUMN user_accounts.amocrm_token_expires_at IS 'Token expiration timestamp for automatic refresh';

-- ============================================================================
-- 2. Add UTM tracking fields to leads table
-- ============================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS amocrm_lead_id BIGINT,
  ADD COLUMN IF NOT EXISTS amocrm_contact_id BIGINT;

COMMENT ON COLUMN leads.utm_source IS 'UTM source parameter (e.g., "facebook", "google")';
COMMENT ON COLUMN leads.utm_medium IS 'UTM medium parameter (e.g., "cpc", "email")';
COMMENT ON COLUMN leads.utm_campaign IS 'UTM campaign parameter';
COMMENT ON COLUMN leads.utm_term IS 'UTM term parameter (keywords)';
COMMENT ON COLUMN leads.utm_content IS 'UTM content parameter (ad variation)';
COMMENT ON COLUMN leads.amocrm_lead_id IS 'AmoCRM lead ID for synced leads';
COMMENT ON COLUMN leads.amocrm_contact_id IS 'AmoCRM contact ID for synced contacts';

-- Create indexes for faster UTM-based queries
CREATE INDEX IF NOT EXISTS idx_leads_utm_campaign ON leads(utm_campaign) WHERE utm_campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_utm_source ON leads(utm_source) WHERE utm_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_amocrm_lead_id ON leads(amocrm_lead_id) WHERE amocrm_lead_id IS NOT NULL;

-- ============================================================================
-- 3. Create amocrm_sync_log table for tracking synchronization
-- ============================================================================

CREATE TABLE IF NOT EXISTS amocrm_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,

  -- AmoCRM entity IDs
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  amocrm_deal_id BIGINT,

  -- Sync metadata
  sync_type TEXT NOT NULL CHECK (sync_type IN (
    'lead_to_amocrm',      -- Creating lead in AmoCRM from our system
    'contact_to_amocrm',   -- Creating contact in AmoCRM
    'deal_from_amocrm',    -- Receiving deal webhook from AmoCRM
    'lead_from_amocrm'     -- Receiving lead webhook from AmoCRM
  )),
  sync_status TEXT NOT NULL CHECK (sync_status IN ('success', 'failed', 'pending', 'retrying')),

  -- Request/response logging
  request_json JSONB,
  response_json JSONB,
  error_message TEXT,
  error_code TEXT,

  -- Retry tracking
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE amocrm_sync_log IS 'Log of all synchronization operations between our system and AmoCRM';
COMMENT ON COLUMN amocrm_sync_log.sync_type IS 'Type of synchronization operation';
COMMENT ON COLUMN amocrm_sync_log.sync_status IS 'Current status of the sync operation';
COMMENT ON COLUMN amocrm_sync_log.request_json IS 'JSON payload sent to AmoCRM API';
COMMENT ON COLUMN amocrm_sync_log.response_json IS 'JSON response from AmoCRM API';

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_amocrm_sync_user_created ON amocrm_sync_log(user_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amocrm_sync_lead ON amocrm_sync_log(amocrm_lead_id) WHERE amocrm_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amocrm_sync_deal ON amocrm_sync_log(amocrm_deal_id) WHERE amocrm_deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amocrm_sync_status ON amocrm_sync_log(sync_status, created_at DESC) WHERE sync_status IN ('failed', 'retrying');

-- ============================================================================
-- 4. Add AmoCRM fields to sales table (for deal tracking)
-- ============================================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS amocrm_deal_id BIGINT,
  ADD COLUMN IF NOT EXISTS amocrm_pipeline_id INTEGER,
  ADD COLUMN IF NOT EXISTS amocrm_status_id INTEGER;

COMMENT ON COLUMN sales.amocrm_deal_id IS 'AmoCRM deal (сделка) ID';
COMMENT ON COLUMN sales.amocrm_pipeline_id IS 'AmoCRM pipeline (воронка) ID';
COMMENT ON COLUMN sales.amocrm_status_id IS 'AmoCRM status (этап) ID';

CREATE INDEX IF NOT EXISTS idx_sales_amocrm_deal_id ON sales(amocrm_deal_id) WHERE amocrm_deal_id IS NOT NULL;

-- ============================================================================
-- 5. Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS on amocrm_sync_log
ALTER TABLE amocrm_sync_log ENABLE ROW LEVEL SECURITY;

-- Users can view their own sync logs
CREATE POLICY "Users can view own sync logs"
  ON amocrm_sync_log FOR SELECT
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

-- Service role has full access
CREATE POLICY "Service role has full access to amocrm_sync_log"
  ON amocrm_sync_log FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 6. Update triggers for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_amocrm_sync_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER amocrm_sync_log_updated_at
  BEFORE UPDATE ON amocrm_sync_log
  FOR EACH ROW
  EXECUTE FUNCTION update_amocrm_sync_log_updated_at();

-- ============================================================================
-- 7. Grant permissions
-- ============================================================================

-- Grant access to authenticated users
GRANT SELECT ON amocrm_sync_log TO authenticated;
GRANT ALL ON amocrm_sync_log TO service_role;
