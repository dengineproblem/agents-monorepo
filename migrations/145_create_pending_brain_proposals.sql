-- Migration 145: Create pending_brain_proposals table for semi-auto mode
-- Хранит proposals, ожидающие одобрения пользователя

CREATE TABLE IF NOT EXISTS pending_brain_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Связи
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Proposals в формате runInteractiveBrain
  -- { action, priority, entity_type, entity_id, entity_name, health_score,
  --   hs_class, reason, confidence, suggested_action_params, metrics }
  proposals JSONB NOT NULL DEFAULT '[]',

  -- Контекст анализа (summary, adset_analysis)
  context JSONB DEFAULT '{}',

  -- Количество proposals
  proposals_count INTEGER DEFAULT 0,

  -- Статус обработки
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'approved', 'rejected', 'expired')),

  -- Связь с уведомлением
  notification_id UUID REFERENCES user_notifications(id) ON DELETE SET NULL,

  -- Время создания и истечения
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
  processed_at TIMESTAMPTZ,

  -- Какие proposals были выполнены (индексы)
  executed_indices INTEGER[] DEFAULT '{}'
);

-- Только один pending набор на аккаунт (partial index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_proposals_unique_pending
ON pending_brain_proposals(ad_account_id)
WHERE status = 'pending';

-- Для поиска по пользователю
CREATE INDEX IF NOT EXISTS idx_pending_proposals_user
ON pending_brain_proposals(user_account_id, status, created_at DESC);

-- Для поиска по аккаунту
CREATE INDEX IF NOT EXISTS idx_pending_proposals_account
ON pending_brain_proposals(ad_account_id, status);

-- RLS
ALTER TABLE pending_brain_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to pending_brain_proposals" ON pending_brain_proposals;
CREATE POLICY "Service role full access to pending_brain_proposals"
ON pending_brain_proposals
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE pending_brain_proposals IS 'Proposals Brain, ожидающие одобрения пользователя (режим semi_auto)';
COMMENT ON COLUMN pending_brain_proposals.proposals IS 'JSON массив proposals из runInteractiveBrain';
COMMENT ON COLUMN pending_brain_proposals.status IS 'pending=ожидает, partial=частично выполнено, approved=полностью одобрено, rejected=отклонено, expired=истекло';
COMMENT ON COLUMN pending_brain_proposals.executed_indices IS 'Массив индексов proposals, которые были выполнены';
