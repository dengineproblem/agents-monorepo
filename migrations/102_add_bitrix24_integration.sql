-- Migration 102: Add Bitrix24 CRM Integration
-- This migration adds Bitrix24 integration support for leads, deals, and sales tracking
-- Supports both leads and deals (unlike AmoCRM where they are the same)

-- ============================================================================
-- 1. Add Bitrix24 OAuth tokens to user_accounts
-- ============================================================================

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_domain TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_access_token TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bitrix24_member_id TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS bitrix24_qualification_fields JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS bitrix24_entity_type TEXT DEFAULT 'deal',
  ADD COLUMN IF NOT EXISTS bitrix24_connected_at TIMESTAMPTZ;

COMMENT ON COLUMN user_accounts.bitrix24_domain IS 'Bitrix24 domain (e.g., "example.bitrix24.ru" or "example.bitrix24.com")';
COMMENT ON COLUMN user_accounts.bitrix24_access_token IS 'Bitrix24 OAuth access token';
COMMENT ON COLUMN user_accounts.bitrix24_refresh_token IS 'Bitrix24 OAuth refresh token';
COMMENT ON COLUMN user_accounts.bitrix24_token_expires_at IS 'Token expiration timestamp (1 hour lifetime)';
COMMENT ON COLUMN user_accounts.bitrix24_member_id IS 'Unique Bitrix24 portal identifier';
COMMENT ON COLUMN user_accounts.bitrix24_user_id IS 'Bitrix24 user ID who authorized the app';
COMMENT ON COLUMN user_accounts.bitrix24_qualification_fields IS 'Array of custom fields for lead qualification (up to 3)';
COMMENT ON COLUMN user_accounts.bitrix24_entity_type IS 'Entity type to work with: "lead", "deal", or "both"';
COMMENT ON COLUMN user_accounts.bitrix24_connected_at IS 'Timestamp when Bitrix24 was connected';

-- ============================================================================
-- 2. Add Bitrix24 fields to leads table
-- ============================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS bitrix24_lead_id BIGINT,
  ADD COLUMN IF NOT EXISTS bitrix24_contact_id BIGINT,
  ADD COLUMN IF NOT EXISTS bitrix24_deal_id BIGINT,
  ADD COLUMN IF NOT EXISTS bitrix24_entity_type TEXT;

COMMENT ON COLUMN leads.bitrix24_lead_id IS 'Bitrix24 CRM lead ID (for lead entity type)';
COMMENT ON COLUMN leads.bitrix24_contact_id IS 'Bitrix24 CRM contact ID';
COMMENT ON COLUMN leads.bitrix24_deal_id IS 'Bitrix24 CRM deal ID (for deal entity type)';
COMMENT ON COLUMN leads.bitrix24_entity_type IS 'Type of Bitrix24 entity: "lead" or "deal"';

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_leads_bitrix24_lead_id ON leads(bitrix24_lead_id) WHERE bitrix24_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_bitrix24_deal_id ON leads(bitrix24_deal_id) WHERE bitrix24_deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_bitrix24_contact_id ON leads(bitrix24_contact_id) WHERE bitrix24_contact_id IS NOT NULL;

-- ============================================================================
-- 3. Add Bitrix24 fields to sales table
-- ============================================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS bitrix24_deal_id BIGINT,
  ADD COLUMN IF NOT EXISTS bitrix24_category_id INTEGER,
  ADD COLUMN IF NOT EXISTS bitrix24_stage_id TEXT;

COMMENT ON COLUMN sales.bitrix24_deal_id IS 'Bitrix24 deal (сделка) ID';
COMMENT ON COLUMN sales.bitrix24_category_id IS 'Bitrix24 deal category/pipeline (воронка) ID';
COMMENT ON COLUMN sales.bitrix24_stage_id IS 'Bitrix24 deal stage (этап) ID';

CREATE INDEX IF NOT EXISTS idx_sales_bitrix24_deal_id ON sales(bitrix24_deal_id) WHERE bitrix24_deal_id IS NOT NULL;

-- ============================================================================
-- 4. Create bitrix24_pipeline_stages table (воронки и этапы)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bitrix24_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Pipeline/Category info
  category_id INTEGER NOT NULL,
  category_name TEXT NOT NULL,

  -- Stage/Status info
  status_id TEXT NOT NULL,
  status_name TEXT NOT NULL,
  status_color TEXT,
  status_sort INTEGER DEFAULT 0,
  status_semantics TEXT,

  -- Entity type (lead or deal)
  entity_type TEXT NOT NULL DEFAULT 'deal' CHECK (entity_type IN ('lead', 'deal')),

  -- Qualification settings (user configurable)
  is_qualified_stage BOOLEAN DEFAULT false,
  is_success_stage BOOLEAN DEFAULT false,
  is_fail_stage BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_account_id, category_id, status_id, entity_type)
);

COMMENT ON TABLE bitrix24_pipeline_stages IS 'Bitrix24 deal categories (pipelines) and lead/deal stages';
COMMENT ON COLUMN bitrix24_pipeline_stages.category_id IS 'Bitrix24 deal category ID (0 for default pipeline, or lead statuses)';
COMMENT ON COLUMN bitrix24_pipeline_stages.status_id IS 'Bitrix24 status ID (e.g., "NEW", "CONVERTED", "C1:NEW")';
COMMENT ON COLUMN bitrix24_pipeline_stages.status_semantics IS 'Bitrix24 stage semantics: "process", "success", "failure"';
COMMENT ON COLUMN bitrix24_pipeline_stages.is_qualified_stage IS 'User-defined: treat this stage as qualified';
COMMENT ON COLUMN bitrix24_pipeline_stages.is_success_stage IS 'Auto-detected or user-defined: this is a success/won stage';
COMMENT ON COLUMN bitrix24_pipeline_stages.is_fail_stage IS 'Auto-detected or user-defined: this is a failure/lost stage';

CREATE INDEX IF NOT EXISTS idx_bitrix24_pipeline_user ON bitrix24_pipeline_stages(user_account_id);
CREATE INDEX IF NOT EXISTS idx_bitrix24_pipeline_entity ON bitrix24_pipeline_stages(user_account_id, entity_type);

-- ============================================================================
-- 5. Create bitrix24_status_history table (история изменений статусов)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bitrix24_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,

  -- Bitrix24 entity IDs
  bitrix24_lead_id BIGINT,
  bitrix24_deal_id BIGINT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('lead', 'deal')),

  -- Status change
  from_status_id TEXT,
  to_status_id TEXT,
  from_category_id INTEGER,
  to_category_id INTEGER,

  -- Webhook data
  webhook_data JSONB,

  changed_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE bitrix24_status_history IS 'History of lead/deal status changes from Bitrix24 webhooks';

CREATE INDEX IF NOT EXISTS idx_bitrix24_status_history_lead ON bitrix24_status_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_bitrix24_status_history_b24_lead ON bitrix24_status_history(bitrix24_lead_id) WHERE bitrix24_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bitrix24_status_history_b24_deal ON bitrix24_status_history(bitrix24_deal_id) WHERE bitrix24_deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bitrix24_status_history_changed ON bitrix24_status_history(user_account_id, changed_at DESC);

-- ============================================================================
-- 6. Create bitrix24_sync_log table (лог синхронизации)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bitrix24_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,

  -- Bitrix24 entity IDs
  bitrix24_lead_id BIGINT,
  bitrix24_deal_id BIGINT,
  bitrix24_contact_id BIGINT,

  -- Sync metadata
  sync_type TEXT NOT NULL CHECK (sync_type IN (
    'lead_to_bitrix',
    'contact_to_bitrix',
    'deal_to_bitrix',
    'lead_from_bitrix',
    'deal_from_bitrix',
    'contact_from_bitrix',
    'status_update'
  )),
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('success', 'failed', 'pending', 'retrying')),

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

COMMENT ON TABLE bitrix24_sync_log IS 'Log of all synchronization operations between our system and Bitrix24';

CREATE INDEX IF NOT EXISTS idx_bitrix24_sync_user_created ON bitrix24_sync_log(user_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bitrix24_sync_lead ON bitrix24_sync_log(bitrix24_lead_id) WHERE bitrix24_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bitrix24_sync_deal ON bitrix24_sync_log(bitrix24_deal_id) WHERE bitrix24_deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bitrix24_sync_status ON bitrix24_sync_log(sync_status, created_at DESC) WHERE sync_status IN ('failed', 'retrying');

-- ============================================================================
-- 7. Add Bitrix24 fields to ad_accounts (for multi-account mode)
-- ============================================================================

ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_domain TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_access_token TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bitrix24_member_id TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS bitrix24_qualification_fields JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS bitrix24_entity_type TEXT DEFAULT 'deal',
  ADD COLUMN IF NOT EXISTS bitrix24_connected_at TIMESTAMPTZ;

-- ============================================================================
-- 8. Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE bitrix24_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitrix24_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitrix24_sync_log ENABLE ROW LEVEL SECURITY;

-- Policies for bitrix24_pipeline_stages
CREATE POLICY "Users can view own pipeline stages"
  ON bitrix24_pipeline_stages FOR SELECT
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

CREATE POLICY "Service role has full access to bitrix24_pipeline_stages"
  ON bitrix24_pipeline_stages FOR ALL
  USING (auth.role() = 'service_role');

-- Policies for bitrix24_status_history
CREATE POLICY "Users can view own status history"
  ON bitrix24_status_history FOR SELECT
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

CREATE POLICY "Service role has full access to bitrix24_status_history"
  ON bitrix24_status_history FOR ALL
  USING (auth.role() = 'service_role');

-- Policies for bitrix24_sync_log
CREATE POLICY "Users can view own sync logs"
  ON bitrix24_sync_log FOR SELECT
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

CREATE POLICY "Service role has full access to bitrix24_sync_log"
  ON bitrix24_sync_log FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 9. Update triggers for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_bitrix24_pipeline_stages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bitrix24_pipeline_stages_updated_at
  BEFORE UPDATE ON bitrix24_pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION update_bitrix24_pipeline_stages_updated_at();

CREATE OR REPLACE FUNCTION update_bitrix24_sync_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bitrix24_sync_log_updated_at
  BEFORE UPDATE ON bitrix24_sync_log
  FOR EACH ROW
  EXECUTE FUNCTION update_bitrix24_sync_log_updated_at();

-- ============================================================================
-- 10. Grant permissions
-- ============================================================================

GRANT SELECT ON bitrix24_pipeline_stages TO authenticated;
GRANT ALL ON bitrix24_pipeline_stages TO service_role;

GRANT SELECT ON bitrix24_status_history TO authenticated;
GRANT ALL ON bitrix24_status_history TO service_role;

GRANT SELECT ON bitrix24_sync_log TO authenticated;
GRANT ALL ON bitrix24_sync_log TO service_role;
