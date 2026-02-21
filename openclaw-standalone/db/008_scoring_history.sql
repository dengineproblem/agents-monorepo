CREATE TABLE scoring_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  adset_id TEXT NOT NULL,
  adset_name TEXT,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,

  -- Health Score
  health_score INTEGER NOT NULL,
  health_class TEXT NOT NULL
    CHECK (health_class IN ('very_good', 'good', 'neutral', 'slightly_bad', 'bad')),

  -- Breakdown
  cpl_score INTEGER,
  trend_score INTEGER,
  diagnostics_score INTEGER,
  today_compensation INTEGER,
  volume_factor DECIMAL(3,2),

  -- Key metrics at scoring time
  ecpl_cents INTEGER,
  ctr DECIMAL(5,2),
  cpm DECIMAL(10,2),
  frequency DECIMAL(5,2),
  impressions INTEGER,
  spend_cents INTEGER,

  -- Action taken
  action_type TEXT CHECK (action_type IN ('budget_increase', 'budget_decrease', 'pause', 'resume', 'none')),
  action_details JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (adset_id, date)
);

CREATE INDEX idx_scoring_date ON scoring_history(date DESC);
CREATE INDEX idx_scoring_class ON scoring_history(health_class, date DESC);
