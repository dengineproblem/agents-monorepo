-- Migration: 099_ai_runs_hybrid_metadata.sql
-- Description: Add hybrid_metadata column for Hybrid MCP Executor observability
-- Author: Claude
-- Date: 2024-12-16

-- Add hybrid_metadata column to ai_runs
-- Stores: {sessionId, allowedTools, playbookId, maxToolCalls, toolCallsUsed, clarifyingAnswers}
ALTER TABLE ai_runs
ADD COLUMN IF NOT EXISTS hybrid_metadata JSONB NULL;

-- Index for filtering runs by playbookId (common query for analytics)
CREATE INDEX IF NOT EXISTS idx_ai_runs_hybrid_playbook
ON ai_runs((hybrid_metadata->>'playbookId'))
WHERE hybrid_metadata IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN ai_runs.hybrid_metadata IS
'Hybrid MCP Executor metadata: {sessionId, allowedTools[], playbookId, intent, maxToolCalls, toolCallsUsed, clarifyingAnswers{}}';
