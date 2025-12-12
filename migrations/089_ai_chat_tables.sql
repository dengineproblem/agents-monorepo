-- Migration: AI Chat Tables for Assistant
-- Creates tables for storing chat conversations and messages

-- Table for chat conversations (like ChatGPT sidebar)
CREATE TABLE IF NOT EXISTS ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL,
    title TEXT DEFAULT 'Новый чат',
    mode TEXT DEFAULT 'auto' CHECK (mode IN ('auto', 'plan', 'ask')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for chat messages
CREATE TABLE IF NOT EXISTS ai_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    plan_json JSONB,          -- Plan data if this is a plan response
    actions_json JSONB,       -- Executed actions data
    tool_calls_json JSONB,    -- Raw tool calls from LLM
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_account_id ON ai_conversations(user_account_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_ad_account_id ON ai_conversations(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at ON ai_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_created_at ON ai_messages(created_at);

-- Enable Row Level Security
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_conversations
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

-- RLS Policies for ai_messages (through conversation ownership)
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

-- Trigger to auto-update updated_at
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

-- Service role bypass policies (for backend access)
CREATE POLICY "Service role full access to conversations" ON ai_conversations
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to messages" ON ai_messages
    FOR ALL USING (true) WITH CHECK (true);
