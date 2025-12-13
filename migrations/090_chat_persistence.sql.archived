-- Chat Persistence: Conversation history for Telegram and Web assistants
-- Tables: chat_conversations, chat_messages, chat_pending_actions

-- ============================================================
-- Conversation header (шапка диалога)
-- ============================================================
CREATE TABLE chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL,

  -- Source: telegram / web
  source TEXT NOT NULL DEFAULT 'telegram',
  telegram_chat_id TEXT,

  -- State
  mode TEXT DEFAULT 'auto' CHECK (mode IN ('auto', 'plan', 'ask')),
  is_processing BOOLEAN DEFAULT FALSE,  -- mutex для concurrency

  -- Rolling summary (для длинных диалогов)
  rolling_summary TEXT,
  summary_updated_at TIMESTAMPTZ,

  -- Metadata
  last_agent TEXT,
  last_domain TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index for telegram_chat_id (partial - only when not null)
CREATE UNIQUE INDEX idx_chat_conversations_telegram ON chat_conversations(telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE INDEX idx_chat_conversations_user ON chat_conversations(user_account_id);
CREATE INDEX idx_chat_conversations_updated ON chat_conversations(updated_at DESC);

-- ============================================================
-- Individual messages
-- ============================================================
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,

  -- Message content
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,

  -- Tool calls (for assistant messages)
  tool_calls JSONB,  -- [{name, arguments, id}]

  -- Tool result (for tool messages)
  tool_call_id TEXT,
  tool_name TEXT,
  tool_result JSONB,

  -- Metadata
  agent TEXT,  -- какой агент обработал
  tokens_used INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX idx_chat_messages_role ON chat_messages(conversation_id, role);

-- ============================================================
-- Pending approvals (для plan/ask mode)
-- ============================================================
CREATE TABLE chat_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,

  tool_name TEXT NOT NULL,
  tool_args JSONB NOT NULL,
  agent TEXT NOT NULL,

  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_pending_actions_conversation ON chat_pending_actions(conversation_id, status);
CREATE INDEX idx_pending_actions_status ON chat_pending_actions(status) WHERE status = 'pending';

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_pending_actions ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY chat_conversations_service_policy ON chat_conversations
  FOR ALL USING (true);

CREATE POLICY chat_messages_service_policy ON chat_messages
  FOR ALL USING (true);

CREATE POLICY chat_pending_actions_service_policy ON chat_pending_actions
  FOR ALL USING (true);

-- ============================================================
-- Helper function: Get conversation by telegram_chat_id
-- ============================================================
CREATE OR REPLACE FUNCTION get_or_create_conversation(
  p_telegram_chat_id TEXT,
  p_user_account_id UUID,
  p_ad_account_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  -- Try to find existing conversation
  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE telegram_chat_id = p_telegram_chat_id
  LIMIT 1;

  -- Create if not exists
  IF v_conversation_id IS NULL THEN
    INSERT INTO chat_conversations (telegram_chat_id, user_account_id, ad_account_id, source)
    VALUES (p_telegram_chat_id, p_user_account_id, p_ad_account_id, 'telegram')
    RETURNING id INTO v_conversation_id;
  END IF;

  RETURN v_conversation_id;
END;
$$;

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE chat_conversations IS 'Chat session headers for Telegram/Web assistants';
COMMENT ON TABLE chat_messages IS 'Individual messages in chat conversations';
COMMENT ON TABLE chat_pending_actions IS 'Pending tool executions requiring user approval';

COMMENT ON COLUMN chat_conversations.is_processing IS 'Mutex flag to prevent concurrent processing';
COMMENT ON COLUMN chat_conversations.rolling_summary IS 'Compressed summary of old messages for context';
COMMENT ON COLUMN chat_conversations.mode IS 'auto: execute tools, plan: propose then confirm, ask: confirm everything';
COMMENT ON COLUMN chat_messages.tool_calls IS 'Array of tool calls made by assistant';
COMMENT ON COLUMN chat_messages.tool_result IS 'Result of tool execution for tool role messages';
