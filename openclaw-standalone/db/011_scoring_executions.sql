CREATE TABLE scoring_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'partial')),
  error_message TEXT,
  adsets_analyzed INTEGER DEFAULT 0,
  high_risk_count INTEGER DEFAULT 0,
  actions_taken JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scoring_exec_date ON scoring_executions(created_at DESC);
