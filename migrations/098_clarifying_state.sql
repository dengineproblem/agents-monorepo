-- Migration: 098_clarifying_state.sql
-- Description: Add clarifying_state persistence for Hybrid MCP Executor
-- Author: Claude
-- Date: 2024-12-16

-- Add clarifying_state column to ai_conversations
-- Stores: {required, questions, answers, complete, policy, originalMessage}
ALTER TABLE ai_conversations
ADD COLUMN IF NOT EXISTS clarifying_state JSONB NULL;

-- Add expiration timestamp for auto-cleanup
ALTER TABLE ai_conversations
ADD COLUMN IF NOT EXISTS clarifying_expires_at TIMESTAMPTZ NULL;

-- Index for finding active clarifying sessions (for cleanup job if needed)
CREATE INDEX IF NOT EXISTS idx_ai_conversations_clarifying_active
ON ai_conversations(clarifying_expires_at)
WHERE clarifying_state IS NOT NULL AND clarifying_expires_at > NOW();

-- Comments for documentation
COMMENT ON COLUMN ai_conversations.clarifying_state IS
'ClarifyingGate state for Hybrid MCP: {required: bool, questions: [], answers: {}, complete: bool, policy: {}, originalMessage: string}';

COMMENT ON COLUMN ai_conversations.clarifying_expires_at IS
'Auto-expire clarifying state after 30 minutes of inactivity. NULL = no active clarifying session';
