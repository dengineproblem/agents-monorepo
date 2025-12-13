-- Migration: AI Pending Plans for Approval Workflow
-- Stores pending plans that require user approval (Web modal or Telegram inline buttons)

-- ============================================================
-- Table for pending plans
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_pending_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,

    -- Plan content
    plan_json JSONB NOT NULL,  -- { steps: [{action, params, description, dangerous}], summary, estimated_impact }

    -- Status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'executing', 'completed', 'failed', 'expired')),

    -- Source info
    source TEXT NOT NULL DEFAULT 'web',  -- web | telegram

    -- Telegram inline keyboard tracking
    telegram_chat_id TEXT,
    telegram_message_id BIGINT,

    -- Execution results
    execution_results JSONB,  -- [{step_index, success, message, error}]
    executed_steps INTEGER DEFAULT 0,
    total_steps INTEGER,

    -- Agent metadata
    agent TEXT,
    domain TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ  -- Optional expiration for pending plans
);

-- ============================================================
-- Indexes
-- ============================================================

-- Find pending plan for conversation
CREATE INDEX IF NOT EXISTS idx_ai_pending_plans_conversation_status
    ON ai_pending_plans(conversation_id, status, created_at DESC);

-- Find pending plans by telegram_chat_id (for callback handling)
CREATE INDEX IF NOT EXISTS idx_ai_pending_plans_telegram
    ON ai_pending_plans(telegram_chat_id, status)
    WHERE telegram_chat_id IS NOT NULL;

-- Find all pending plans (for cleanup/expiration)
CREATE INDEX IF NOT EXISTS idx_ai_pending_plans_status
    ON ai_pending_plans(status, created_at)
    WHERE status = 'pending';

-- ============================================================
-- Enable Row Level Security
-- ============================================================
ALTER TABLE ai_pending_plans ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "Service role full access to pending plans" ON ai_pending_plans
    FOR ALL USING (true) WITH CHECK (true);

-- Users can view their own pending plans (through conversation ownership)
CREATE POLICY "Users can view own pending plans" ON ai_pending_plans
    FOR SELECT USING (
        conversation_id IN (
            SELECT id FROM ai_conversations WHERE user_account_id IN (
                SELECT id FROM user_accounts
            )
        )
    );

-- ============================================================
-- Helper function: Get pending plan for conversation
-- ============================================================
CREATE OR REPLACE FUNCTION get_pending_plan_for_conversation(p_conversation_id UUID)
RETURNS TABLE (
    id UUID,
    plan_json JSONB,
    status TEXT,
    source TEXT,
    telegram_message_id BIGINT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pp.id,
        pp.plan_json,
        pp.status,
        pp.source,
        pp.telegram_message_id,
        pp.created_at
    FROM ai_pending_plans pp
    WHERE pp.conversation_id = p_conversation_id
      AND pp.status = 'pending'
    ORDER BY pp.created_at DESC
    LIMIT 1;
END;
$$;

-- ============================================================
-- Helper function: Approve and start execution
-- ============================================================
CREATE OR REPLACE FUNCTION approve_pending_plan(p_plan_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated BOOLEAN;
BEGIN
    UPDATE ai_pending_plans
    SET status = 'approved',
        resolved_at = NOW()
    WHERE id = p_plan_id
      AND status = 'pending'
    RETURNING TRUE INTO v_updated;

    RETURN COALESCE(v_updated, FALSE);
END;
$$;

-- ============================================================
-- Helper function: Reject plan
-- ============================================================
CREATE OR REPLACE FUNCTION reject_pending_plan(p_plan_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated BOOLEAN;
BEGIN
    UPDATE ai_pending_plans
    SET status = 'rejected',
        resolved_at = NOW()
    WHERE id = p_plan_id
      AND status = 'pending'
    RETURNING TRUE INTO v_updated;

    RETURN COALESCE(v_updated, FALSE);
END;
$$;

-- ============================================================
-- Helper function: Expire old pending plans
-- ============================================================
CREATE OR REPLACE FUNCTION expire_old_pending_plans(p_hours INTEGER DEFAULT 24)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE ai_pending_plans
    SET status = 'expired',
        resolved_at = NOW()
    WHERE status = 'pending'
      AND created_at < NOW() - (p_hours || ' hours')::INTERVAL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE ai_pending_plans IS 'Pending plans requiring user approval (Web modal or Telegram inline buttons)';

COMMENT ON COLUMN ai_pending_plans.plan_json IS 'Plan structure: {steps: [{action, params, description, dangerous}], summary, estimated_impact}';
COMMENT ON COLUMN ai_pending_plans.status IS 'pending: awaiting approval, approved: ready to execute, rejected: user declined, executing: in progress, completed: done, failed: error, expired: timed out';
COMMENT ON COLUMN ai_pending_plans.telegram_message_id IS 'Telegram message ID containing inline keyboard buttons';
COMMENT ON COLUMN ai_pending_plans.execution_results IS 'Results of each step execution: [{step_index, success, message, error}]';
COMMENT ON COLUMN ai_pending_plans.expires_at IS 'Optional expiration time for auto-rejection';
