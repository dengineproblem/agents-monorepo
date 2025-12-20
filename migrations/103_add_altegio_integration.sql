-- Migration 103: Add Altegio (YCLIENTS) CRM Integration
-- This migration adds Altegio integration for appointment-based lead qualification and sales tracking
--
-- Key differences from AMO/Bitrix:
-- - Qualification = client booked an appointment (not custom field)
-- - Sales = financial transactions (actual payments)
-- - Authorization: Partner Token + User Token (not OAuth refresh flow)
-- - Rate limit: 5 req/sec or 200 req/min

-- ============================================================================
-- 1. Add Altegio credentials to user_accounts
-- ============================================================================

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS altegio_company_id INTEGER,
  ADD COLUMN IF NOT EXISTS altegio_partner_token TEXT,
  ADD COLUMN IF NOT EXISTS altegio_user_token TEXT,
  ADD COLUMN IF NOT EXISTS altegio_company_name TEXT,
  ADD COLUMN IF NOT EXISTS altegio_connected_at TIMESTAMPTZ;

COMMENT ON COLUMN user_accounts.altegio_company_id IS 'Altegio company (salon) ID';
COMMENT ON COLUMN user_accounts.altegio_partner_token IS 'Partner API token from Altegio Marketplace';
COMMENT ON COLUMN user_accounts.altegio_user_token IS 'User token for authenticated API methods';
COMMENT ON COLUMN user_accounts.altegio_company_name IS 'Company name in Altegio';
COMMENT ON COLUMN user_accounts.altegio_connected_at IS 'Timestamp when Altegio was connected';

-- ============================================================================
-- 2. Add qualification source tracking to leads
-- ============================================================================

-- Add qualification source field to track where qualification came from
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS qualified_source TEXT,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;

COMMENT ON COLUMN leads.qualified_source IS 'Source of qualification: amocrm, bitrix24, or altegio';
COMMENT ON COLUMN leads.qualified_at IS 'Timestamp when lead was qualified';

-- Add Altegio-specific fields to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS altegio_client_id BIGINT,
  ADD COLUMN IF NOT EXISTS altegio_record_id BIGINT;

COMMENT ON COLUMN leads.altegio_client_id IS 'Altegio client ID';
COMMENT ON COLUMN leads.altegio_record_id IS 'Altegio first record (appointment) ID that qualified the lead';

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_leads_altegio_client_id ON leads(altegio_client_id) WHERE altegio_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_altegio_record_id ON leads(altegio_record_id) WHERE altegio_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_qualified_source ON leads(qualified_source) WHERE qualified_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_qualified_at ON leads(qualified_at) WHERE qualified_at IS NOT NULL;

-- ============================================================================
-- 3. Add Altegio fields to sales/purchases table
-- ============================================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS altegio_record_id BIGINT,
  ADD COLUMN IF NOT EXISTS altegio_transaction_id BIGINT;

COMMENT ON COLUMN sales.altegio_record_id IS 'Altegio record (appointment) ID';
COMMENT ON COLUMN sales.altegio_transaction_id IS 'Altegio financial transaction ID';

CREATE INDEX IF NOT EXISTS idx_sales_altegio_record_id ON sales(altegio_record_id) WHERE altegio_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_altegio_transaction_id ON sales(altegio_transaction_id) WHERE altegio_transaction_id IS NOT NULL;

-- ============================================================================
-- 4. Create altegio_records table (appointment history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS altegio_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,

  -- Altegio IDs
  altegio_record_id BIGINT NOT NULL,
  altegio_client_id BIGINT,
  altegio_company_id INTEGER NOT NULL,

  -- Client info (denormalized for convenience)
  client_phone TEXT,
  client_name TEXT,

  -- Staff info
  staff_id INTEGER,
  staff_name TEXT,

  -- Services
  service_ids INTEGER[],
  service_names TEXT[],
  total_cost DECIMAL(12, 2),

  -- Appointment time
  record_datetime TIMESTAMPTZ,
  seance_length INTEGER,  -- Duration in seconds

  -- Status
  -- attendance: 2=confirmed came, 1=came, 0=expected, -1=not confirmed, -2=cancelled
  attendance INTEGER DEFAULT 0,
  confirmed BOOLEAN DEFAULT false,

  -- Metadata
  webhook_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_account_id, altegio_record_id)
);

COMMENT ON TABLE altegio_records IS 'Altegio appointment records for tracking and history';
COMMENT ON COLUMN altegio_records.attendance IS 'Attendance status: 2=confirmed came, 1=came, 0=expected, -1=not confirmed, -2=cancelled';
COMMENT ON COLUMN altegio_records.seance_length IS 'Duration in seconds';

CREATE INDEX IF NOT EXISTS idx_altegio_records_user ON altegio_records(user_account_id);
CREATE INDEX IF NOT EXISTS idx_altegio_records_lead ON altegio_records(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_altegio_records_client_phone ON altegio_records(user_account_id, client_phone);
CREATE INDEX IF NOT EXISTS idx_altegio_records_datetime ON altegio_records(user_account_id, record_datetime DESC);

-- ============================================================================
-- 5. Create altegio_transactions table (financial operations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS altegio_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,

  -- Altegio IDs
  altegio_transaction_id BIGINT NOT NULL,
  altegio_record_id BIGINT,
  altegio_client_id BIGINT,
  altegio_company_id INTEGER NOT NULL,

  -- Client info
  client_phone TEXT,
  client_name TEXT,

  -- Transaction details
  amount DECIMAL(12, 2) NOT NULL,
  transaction_type INTEGER,  -- 1=income, 2=expense
  payment_type INTEGER,

  -- Metadata
  webhook_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_account_id, altegio_transaction_id)
);

COMMENT ON TABLE altegio_transactions IS 'Altegio financial transactions for ROI calculation';
COMMENT ON COLUMN altegio_transactions.transaction_type IS '1=income (payment), 2=expense';

CREATE INDEX IF NOT EXISTS idx_altegio_transactions_user ON altegio_transactions(user_account_id);
CREATE INDEX IF NOT EXISTS idx_altegio_transactions_lead ON altegio_transactions(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_altegio_transactions_client_phone ON altegio_transactions(user_account_id, client_phone);
CREATE INDEX IF NOT EXISTS idx_altegio_transactions_record ON altegio_transactions(altegio_record_id) WHERE altegio_record_id IS NOT NULL;

-- ============================================================================
-- 6. Create altegio_sync_log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS altegio_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,

  -- Altegio IDs
  altegio_record_id BIGINT,
  altegio_transaction_id BIGINT,
  altegio_client_id BIGINT,

  -- Sync metadata
  sync_type TEXT NOT NULL CHECK (sync_type IN (
    'record_created',
    'record_updated',
    'record_deleted',
    'transaction_created',
    'client_matched',
    'qualification_set',
    'manual_sync'
  )),
  sync_status TEXT NOT NULL DEFAULT 'success' CHECK (sync_status IN ('success', 'failed', 'skipped')),

  -- Request/response logging
  webhook_data JSONB,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE altegio_sync_log IS 'Log of all Altegio webhook events and sync operations';

CREATE INDEX IF NOT EXISTS idx_altegio_sync_user_created ON altegio_sync_log(user_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_altegio_sync_type ON altegio_sync_log(sync_type, created_at DESC);

-- ============================================================================
-- 7. Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE altegio_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE altegio_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE altegio_sync_log ENABLE ROW LEVEL SECURITY;

-- Policies for altegio_records
CREATE POLICY "Users can view own altegio records"
  ON altegio_records FOR SELECT
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

CREATE POLICY "Service role has full access to altegio_records"
  ON altegio_records FOR ALL
  USING (auth.role() = 'service_role');

-- Policies for altegio_transactions
CREATE POLICY "Users can view own altegio transactions"
  ON altegio_transactions FOR SELECT
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

CREATE POLICY "Service role has full access to altegio_transactions"
  ON altegio_transactions FOR ALL
  USING (auth.role() = 'service_role');

-- Policies for altegio_sync_log
CREATE POLICY "Users can view own altegio sync logs"
  ON altegio_sync_log FOR SELECT
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

CREATE POLICY "Service role has full access to altegio_sync_log"
  ON altegio_sync_log FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 8. Update triggers for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_altegio_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER altegio_records_updated_at
  BEFORE UPDATE ON altegio_records
  FOR EACH ROW
  EXECUTE FUNCTION update_altegio_records_updated_at();

-- ============================================================================
-- 9. Grant permissions
-- ============================================================================

GRANT SELECT ON altegio_records TO authenticated;
GRANT ALL ON altegio_records TO service_role;

GRANT SELECT ON altegio_transactions TO authenticated;
GRANT ALL ON altegio_transactions TO service_role;

GRANT SELECT ON altegio_sync_log TO authenticated;
GRANT ALL ON altegio_sync_log TO service_role;
