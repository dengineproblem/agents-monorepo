-- Migration 095: AI Runs - LLM call tracing for Chat Assistant
-- Purpose: Full audit trail for debugging "why the response was bad"

-- Create ai_runs table for LLM call tracing
CREATE TABLE IF NOT EXISTS ai_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES ai_messages(id) ON DELETE SET NULL,
  user_account_id UUID NOT NULL,

  -- LLM info
  model TEXT NOT NULL,
  prompt_version TEXT,

  -- Tokens
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,

  -- Tools
  tools_planned JSONB DEFAULT '[]',     -- [{name, args}] - what LLM wanted to call
  tools_executed JSONB DEFAULT '[]',    -- [{name, args, success, latency_ms, cached}]
  tool_errors JSONB DEFAULT '[]',       -- [{name, error, code}]

  -- Context stats
  context_stats JSONB,                  -- {utilization, blocksIncluded, trimmed, totalTokens}
  snapshot_used BOOLEAN DEFAULT false,
  rolling_summary_used BOOLEAN DEFAULT false,

  -- Performance
  latency_ms INTEGER,
  retries INTEGER DEFAULT 0,

  -- Classification
  domain TEXT,                          -- ads, creative, crm, whatsapp, mixed
  agent TEXT,                           -- AdsAgent, CreativeAgent, etc.

  -- Request info
  user_message TEXT,                    -- Original user message (truncated to 500 chars)

  -- Status
  status TEXT DEFAULT 'pending',        -- pending | completed | error
  error_message TEXT,
  error_code TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_runs_conversation ON ai_runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_user ON ai_runs(user_account_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_created ON ai_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_status ON ai_runs(status) WHERE status = 'error';
CREATE INDEX IF NOT EXISTS idx_ai_runs_agent ON ai_runs(agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_domain ON ai_runs(domain, created_at DESC);

-- Add summary_message_count to ai_conversations for rolling summary tracking
ALTER TABLE ai_conversations
ADD COLUMN IF NOT EXISTS summary_message_count INTEGER DEFAULT 0;

COMMENT ON COLUMN ai_conversations.summary_message_count IS 'Number of messages when rolling_summary was last updated';

-- RLS policy for ai_runs
ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own runs" ON ai_runs
  FOR SELECT
  USING (user_account_id = auth.uid());

CREATE POLICY "Service role full access to ai_runs" ON ai_runs
  FOR ALL
  USING (auth.role() = 'service_role');

-- Function to cleanup old ai_runs (retention policy)
CREATE OR REPLACE FUNCTION cleanup_old_ai_runs(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM ai_runs
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_old_ai_runs IS 'Cleanup ai_runs older than retention_days (default 30)';

-- Function to get run stats for a conversation
CREATE OR REPLACE FUNCTION get_conversation_run_stats(p_conversation_id UUID)
RETURNS TABLE (
  total_runs INTEGER,
  completed_runs INTEGER,
  error_runs INTEGER,
  avg_latency_ms NUMERIC,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  most_used_agent TEXT,
  last_run_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as total_runs,
    COUNT(*) FILTER (WHERE status = 'completed')::INTEGER as completed_runs,
    COUNT(*) FILTER (WHERE status = 'error')::INTEGER as error_runs,
    ROUND(AVG(latency_ms), 2) as avg_latency_ms,
    SUM(input_tokens)::BIGINT as total_input_tokens,
    SUM(output_tokens)::BIGINT as total_output_tokens,
    MODE() WITHIN GROUP (ORDER BY agent) as most_used_agent,
    MAX(created_at) as last_run_at
  FROM ai_runs
  WHERE conversation_id = p_conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_conversation_run_stats IS 'Get aggregated stats for all runs in a conversation';
