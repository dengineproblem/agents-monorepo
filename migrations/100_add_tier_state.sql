-- Migration: 100_add_tier_state.sql
-- Description: Add tier_state persistence for Tier-based Playbook Registry
-- Author: Claude
-- Date: 2024-12-16

-- ============================================================
-- Add tier_state column to ai_conversations
-- Stores tier state for progressive disclosure:
-- {
--   playbookId: string,
--   currentTier: 'snapshot' | 'drilldown' | 'actions',
--   completedTiers: string[],
--   snapshotData: Object,
--   transitionHistory: Array,
--   pendingNextStep: Object|null,
--   domain: string,
--   createdAt: timestamp,
--   lastTransitionAt: timestamp
-- }
-- ============================================================

ALTER TABLE ai_conversations
ADD COLUMN IF NOT EXISTS tier_state JSONB NULL;

-- Add expiration timestamp for auto-cleanup (TTL 1 hour)
ALTER TABLE ai_conversations
ADD COLUMN IF NOT EXISTS tier_expires_at TIMESTAMPTZ NULL;

-- Index for finding active tier sessions (for cleanup and queries)
CREATE INDEX IF NOT EXISTS idx_ai_conversations_tier_active
ON ai_conversations(tier_expires_at)
WHERE tier_state IS NOT NULL AND tier_expires_at > NOW();

-- Index for querying by playbook
CREATE INDEX IF NOT EXISTS idx_ai_conversations_tier_playbook
ON ai_conversations((tier_state->>'playbookId'))
WHERE tier_state IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN ai_conversations.tier_state IS
'Tier state for Playbook Registry: {playbookId, currentTier, completedTiers, snapshotData, transitionHistory, pendingNextStep}';

COMMENT ON COLUMN ai_conversations.tier_expires_at IS
'Auto-expire tier state after 1 hour of inactivity. NULL = no active tier session';
