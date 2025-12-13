-- Migration: 093_idempotent_operations.sql
-- Purpose: Idempotency support for WRITE operations in Chat Assistant
-- Prevents duplicate execution of the same operation (retry, double-click, etc.)

-- ============================================================
-- Table: ai_idempotent_operations
-- Stores executed operations to detect and prevent duplicates
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_idempotent_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Idempotency key (SHA256 hash or user-provided operation_id)
    operation_key TEXT NOT NULL,

    -- Context
    user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL,

    -- Tool information
    tool_name TEXT NOT NULL,
    tool_args JSONB NOT NULL DEFAULT '{}',

    -- Execution result (cached for idempotent return)
    result JSONB NOT NULL DEFAULT '{}',
    success BOOLEAN NOT NULL DEFAULT true,

    -- Metadata
    source TEXT DEFAULT 'chat_assistant', -- 'chat_assistant' | 'plan_executor' | 'api'
    plan_id UUID REFERENCES ai_pending_plans(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',

    -- Unique constraint: same operation key per user = idempotent
    CONSTRAINT unique_operation_key UNIQUE (operation_key, user_account_id)
);

-- ============================================================
-- Indexes
-- ============================================================

-- Fast lookup by operation key
CREATE INDEX IF NOT EXISTS idx_idempotent_ops_key
    ON ai_idempotent_operations(operation_key, user_account_id);

-- Cleanup expired entries
CREATE INDEX IF NOT EXISTS idx_idempotent_ops_expires
    ON ai_idempotent_operations(expires_at)
    WHERE expires_at IS NOT NULL;

-- Find by user account
CREATE INDEX IF NOT EXISTS idx_idempotent_ops_user
    ON ai_idempotent_operations(user_account_id, created_at DESC);

-- Find by plan (for plan retry detection)
CREATE INDEX IF NOT EXISTS idx_idempotent_ops_plan
    ON ai_idempotent_operations(plan_id)
    WHERE plan_id IS NOT NULL;

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

ALTER TABLE ai_idempotent_operations ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "Service role full access on ai_idempotent_operations"
    ON ai_idempotent_operations
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- Cleanup function for expired operations
-- Call periodically (e.g., daily via cron)
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_idempotent_operations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM ai_idempotent_operations
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ============================================================
-- Helper function: Check if operation already executed
-- Returns the cached result or NULL
-- ============================================================

CREATE OR REPLACE FUNCTION check_idempotent_operation(
    p_operation_key TEXT,
    p_user_account_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
    v_expires_at TIMESTAMPTZ;
BEGIN
    SELECT result, expires_at
    INTO v_result, v_expires_at
    FROM ai_idempotent_operations
    WHERE operation_key = p_operation_key
      AND user_account_id = p_user_account_id;

    -- Not found
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Expired
    IF v_expires_at IS NOT NULL AND v_expires_at < NOW() THEN
        -- Delete expired entry
        DELETE FROM ai_idempotent_operations
        WHERE operation_key = p_operation_key
          AND user_account_id = p_user_account_id;
        RETURN NULL;
    END IF;

    RETURN v_result;
END;
$$;

-- ============================================================
-- Comment
-- ============================================================

COMMENT ON TABLE ai_idempotent_operations IS
    'Stores executed WRITE operations for idempotency. Prevents duplicate execution on retry/double-click.';
