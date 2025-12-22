-- Migration: Add fb_query_log table for customFbQuery learning
-- Purpose: Store successful custom FB API queries for few-shot learning and analytics

CREATE TABLE IF NOT EXISTS fb_query_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  user_request TEXT NOT NULL,
  generated_query JSONB NOT NULL,
  response_summary JSONB,
  success BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user queries lookup
CREATE INDEX IF NOT EXISTS idx_fb_query_log_user_account
  ON fb_query_log(user_account_id);

-- Index for recent queries
CREATE INDEX IF NOT EXISTS idx_fb_query_log_created_at
  ON fb_query_log(created_at DESC);

-- Index for successful queries (for few-shot selection)
CREATE INDEX IF NOT EXISTS idx_fb_query_log_success
  ON fb_query_log(success) WHERE success = true;

-- RLS policies
ALTER TABLE fb_query_log ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY fb_query_log_service_policy ON fb_query_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE fb_query_log IS 'Stores successful custom FB API queries for few-shot learning';
COMMENT ON COLUMN fb_query_log.user_request IS 'Original user request in natural language';
COMMENT ON COLUMN fb_query_log.generated_query IS 'LLM-generated FB API query (endpoint, fields, params)';
COMMENT ON COLUMN fb_query_log.response_summary IS 'Summary of FB API response (row count, has data)';
