-- Migration 028: AmoCRM Pipeline Stages and Qualification Tracking
-- Description: Add pipeline stages tracking and lead qualification system
-- Date: 2025-11-05

-- ============================================================================
-- 1. Add current pipeline/status fields to leads
-- ============================================================================

ALTER TABLE leads 
  ADD COLUMN IF NOT EXISTS current_pipeline_id INTEGER,
  ADD COLUMN IF NOT EXISTS current_status_id INTEGER,
  ADD COLUMN IF NOT EXISTS is_qualified BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN leads.current_pipeline_id IS 'Current amoCRM pipeline ID';
COMMENT ON COLUMN leads.current_status_id IS 'Current amoCRM status (stage) ID';
COMMENT ON COLUMN leads.is_qualified IS 'Whether lead is in a qualified stage (computed from pipeline_stages)';

-- Create index for fast pipeline/status queries
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_status 
  ON leads(current_pipeline_id, current_status_id) 
  WHERE current_pipeline_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_is_qualified 
  ON leads(is_qualified) 
  WHERE is_qualified = TRUE;

-- ============================================================================
-- 2. Create amoCRM pipeline stages table (справочник воронок)
-- ============================================================================

CREATE TABLE IF NOT EXISTS amocrm_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Pipeline metadata
  pipeline_id INTEGER NOT NULL,
  pipeline_name TEXT NOT NULL,
  
  -- Status (stage) metadata
  status_id INTEGER NOT NULL,
  status_name TEXT NOT NULL,
  status_color TEXT,
  
  -- Qualification settings (user-configurable)
  is_qualified_stage BOOLEAN DEFAULT FALSE,
  
  -- Ordering
  sort_order INTEGER,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint per user account
  UNIQUE(user_account_id, pipeline_id, status_id)
);

COMMENT ON TABLE amocrm_pipeline_stages IS 'amoCRM pipeline stages (воронки и этапы) with qualification mapping';
COMMENT ON COLUMN amocrm_pipeline_stages.is_qualified_stage IS 'User-configurable: if TRUE, leads in this stage are considered qualified';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_amocrm_stages_user 
  ON amocrm_pipeline_stages(user_account_id);

CREATE INDEX IF NOT EXISTS idx_amocrm_stages_pipeline 
  ON amocrm_pipeline_stages(user_account_id, pipeline_id);

CREATE INDEX IF NOT EXISTS idx_amocrm_stages_qualified 
  ON amocrm_pipeline_stages(user_account_id, is_qualified_stage) 
  WHERE is_qualified_stage = TRUE;

-- ============================================================================
-- 3. Create lead status change history table
-- ============================================================================

CREATE TABLE IF NOT EXISTS amocrm_lead_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  amocrm_lead_id BIGINT,
  
  -- Status change details
  from_status_id INTEGER,
  to_status_id INTEGER,
  from_pipeline_id INTEGER,
  to_pipeline_id INTEGER,
  
  -- Timing
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Original webhook payload (for debugging/audit)
  webhook_data JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE amocrm_lead_status_history IS 'History of lead status changes from amoCRM webhooks';
COMMENT ON COLUMN amocrm_lead_status_history.webhook_data IS 'Original webhook payload for audit';

-- Indexes for querying history
CREATE INDEX IF NOT EXISTS idx_amocrm_history_lead 
  ON amocrm_lead_status_history(lead_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_amocrm_history_amocrm_lead 
  ON amocrm_lead_status_history(amocrm_lead_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_amocrm_history_changed_at 
  ON amocrm_lead_status_history(changed_at DESC);

-- ============================================================================
-- 4. Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS
ALTER TABLE amocrm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE amocrm_lead_status_history ENABLE ROW LEVEL SECURITY;

-- Users can view their own pipeline stages
CREATE POLICY "Users can view own pipeline stages"
  ON amocrm_pipeline_stages FOR SELECT
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

-- Users can update their own pipeline stages
CREATE POLICY "Users can update own pipeline stages"
  ON amocrm_pipeline_stages FOR UPDATE
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

-- Users can view their own lead status history
CREATE POLICY "Users can view own lead status history"
  ON amocrm_lead_status_history FOR SELECT
  USING (
    auth.uid() = (
      SELECT user_account_id FROM leads WHERE id = lead_id
    )
  );

-- Service role has full access
CREATE POLICY "Service role has full access to amocrm_pipeline_stages"
  ON amocrm_pipeline_stages FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to amocrm_lead_status_history"
  ON amocrm_lead_status_history FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 5. Update triggers for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_amocrm_pipeline_stages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER amocrm_pipeline_stages_updated_at
  BEFORE UPDATE ON amocrm_pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION update_amocrm_pipeline_stages_updated_at();

-- ============================================================================
-- 6. Grant permissions
-- ============================================================================

GRANT SELECT ON amocrm_pipeline_stages TO authenticated;
GRANT SELECT ON amocrm_lead_status_history TO authenticated;
GRANT ALL ON amocrm_pipeline_stages TO service_role;
GRANT ALL ON amocrm_lead_status_history TO service_role;

-- ============================================================================
-- 7. Initial data: Mark "won" stage as qualified by default
-- ============================================================================

-- This will be populated when users sync their pipelines
-- Status ID 142 (won) should be marked as qualified by default
-- Status ID 143 (lost) should NOT be marked as qualified

COMMENT ON TABLE amocrm_pipeline_stages IS 
  'Pipeline stages from amoCRM. System statuses: 142=won (qualified), 143=lost (not qualified)';

