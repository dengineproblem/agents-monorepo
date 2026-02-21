CREATE TABLE direction_adsets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  fb_adset_id TEXT NOT NULL,
  adset_name TEXT,
  daily_budget_cents INTEGER,
  status TEXT DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED')),
  ads_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (direction_id, fb_adset_id)
);

CREATE INDEX idx_direction_adsets_active ON direction_adsets(direction_id) WHERE is_active = true;
