-- Migration: AI Chat Tables for Assistant (Unified Web + Telegram)
-- Creates tables for storing chat conversations and messages

-- ============================================================
-- Table for chat conversations (unified for Web and Telegram)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL,

    -- Basic info
    title TEXT DEFAULT 'Новый чат',
    mode TEXT DEFAULT 'auto' CHECK (mode IN ('auto', 'plan', 'ask')),

    -- Source: web or telegram
    source TEXT NOT NULL DEFAULT 'web',
    telegram_chat_id TEXT,

    -- Concurrency control
    is_processing BOOLEAN DEFAULT FALSE,
    processing_started_at TIMESTAMPTZ,

    -- Rolling summary for long conversations
    rolling_summary TEXT,
    summary_updated_at TIMESTAMPTZ,

    -- Metadata
    last_agent TEXT,
    last_domain TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table for chat messages (unified format)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,

    -- Message content
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT,

    -- Plan data (for assistant messages with plans)
    plan_json JSONB,
    actions_json JSONB,

    -- Tool calls (for assistant messages)
    tool_calls JSONB,           -- [{id, name, arguments}]
    tool_calls_json JSONB,      -- Legacy: Raw tool calls from LLM

    -- Tool result (for tool role messages)
    tool_call_id TEXT,
    tool_name TEXT,
    tool_result JSONB,

    -- Metadata
    agent TEXT,
    tokens_used INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_account_id ON ai_conversations(user_account_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_ad_account_id ON ai_conversations(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at ON ai_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_created_at ON ai_messages(created_at);

-- Telegram-specific index (unique per telegram_chat_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_conversations_telegram
    ON ai_conversations(telegram_chat_id)
    WHERE telegram_chat_id IS NOT NULL;

-- Message lookup by conversation and role
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_role
    ON ai_messages(conversation_id, role);

-- Message lookup by conversation ordered by time
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created
    ON ai_messages(conversation_id, created_at DESC);

-- ============================================================
-- Enable Row Level Security
-- ============================================================
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS Policies for ai_conversations
-- ============================================================
CREATE POLICY "Users can view own conversations" ON ai_conversations
    FOR SELECT USING (
        user_account_id IN (
            SELECT id FROM user_accounts WHERE id = user_account_id
        )
    );

CREATE POLICY "Users can insert own conversations" ON ai_conversations
    FOR INSERT WITH CHECK (
        user_account_id IN (
            SELECT id FROM user_accounts WHERE id = user_account_id
        )
    );

CREATE POLICY "Users can update own conversations" ON ai_conversations
    FOR UPDATE USING (
        user_account_id IN (
            SELECT id FROM user_accounts WHERE id = user_account_id
        )
    );

CREATE POLICY "Users can delete own conversations" ON ai_conversations
    FOR DELETE USING (
        user_account_id IN (
            SELECT id FROM user_accounts WHERE id = user_account_id
        )
    );

-- ============================================================
-- RLS Policies for ai_messages (through conversation ownership)
-- ============================================================
CREATE POLICY "Users can view messages in own conversations" ON ai_messages
    FOR SELECT USING (
        conversation_id IN (
            SELECT id FROM ai_conversations WHERE user_account_id IN (
                SELECT id FROM user_accounts
            )
        )
    );

CREATE POLICY "Users can insert messages in own conversations" ON ai_messages
    FOR INSERT WITH CHECK (
        conversation_id IN (
            SELECT id FROM ai_conversations WHERE user_account_id IN (
                SELECT id FROM user_accounts
            )
        )
    );

CREATE POLICY "Users can update messages in own conversations" ON ai_messages
    FOR UPDATE USING (
        conversation_id IN (
            SELECT id FROM ai_conversations WHERE user_account_id IN (
                SELECT id FROM user_accounts
            )
        )
    );

CREATE POLICY "Users can delete messages in own conversations" ON ai_messages
    FOR DELETE USING (
        conversation_id IN (
            SELECT id FROM ai_conversations WHERE user_account_id IN (
                SELECT id FROM user_accounts
            )
        )
    );

-- ============================================================
-- Trigger to auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_ai_conversation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE ai_conversations
    SET updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_messages_update_conversation_timestamp
    AFTER INSERT ON ai_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_conversation_updated_at();

-- ============================================================
-- Service role bypass policies (for backend access)
-- ============================================================
CREATE POLICY "Service role full access to conversations" ON ai_conversations
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to messages" ON ai_messages
    FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Helper function: Get or create conversation by telegram_chat_id
-- ============================================================
CREATE OR REPLACE FUNCTION get_or_create_ai_conversation(
    p_source TEXT,
    p_user_account_id UUID,
    p_ad_account_id UUID DEFAULT NULL,
    p_telegram_chat_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_conversation_id UUID;
BEGIN
    -- For Telegram, try to find existing by telegram_chat_id
    IF p_source = 'telegram' AND p_telegram_chat_id IS NOT NULL THEN
        SELECT id INTO v_conversation_id
        FROM ai_conversations
        WHERE telegram_chat_id = p_telegram_chat_id
        LIMIT 1;
    END IF;

    -- Create if not exists
    IF v_conversation_id IS NULL THEN
        INSERT INTO ai_conversations (
            user_account_id,
            ad_account_id,
            source,
            telegram_chat_id,
            title
        ) VALUES (
            p_user_account_id,
            p_ad_account_id,
            p_source,
            p_telegram_chat_id,
            CASE WHEN p_source = 'telegram' THEN 'Telegram Chat' ELSE 'Новый чат' END
        )
        RETURNING id INTO v_conversation_id;
    END IF;

    RETURN v_conversation_id;
END;
$$;

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE ai_conversations IS 'Unified chat sessions for Web and Telegram assistants';
COMMENT ON TABLE ai_messages IS 'Individual messages in chat conversations';

COMMENT ON COLUMN ai_conversations.source IS 'Source of conversation: web or telegram';
COMMENT ON COLUMN ai_conversations.is_processing IS 'Mutex flag to prevent concurrent processing';
COMMENT ON COLUMN ai_conversations.rolling_summary IS 'Compressed summary of old messages for context';
COMMENT ON COLUMN ai_conversations.mode IS 'auto: execute tools, plan: propose then confirm, ask: confirm everything';

COMMENT ON COLUMN ai_messages.role IS 'Message role: user, assistant, system, or tool';
COMMENT ON COLUMN ai_messages.tool_calls IS 'Array of tool calls made by assistant [{id, name, arguments}]';
COMMENT ON COLUMN ai_messages.tool_result IS 'Result of tool execution for tool role messages';
COMMENT ON COLUMN ai_messages.agent IS 'Which agent processed this message (AdsAgent, CRMAgent, etc)';
