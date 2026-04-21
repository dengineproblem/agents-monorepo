-- migrations/254_support_escalations.sql
CREATE TABLE support_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  category TEXT,
  summary TEXT NOT NULL,
  context_messages JSONB,
  notified_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES user_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_escalations_user_account
  ON support_escalations(user_account_id);
CREATE INDEX idx_support_escalations_created_at
  ON support_escalations(created_at DESC);
CREATE INDEX idx_support_escalations_unresolved
  ON support_escalations(created_at DESC) WHERE resolved_at IS NULL;

COMMENT ON TABLE support_escalations IS
  'Эскалации от AI-чата тех.поддержки живому админу (reason + context для стат. и просмотра)';
