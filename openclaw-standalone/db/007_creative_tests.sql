CREATE TABLE creative_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID NOT NULL REFERENCES creatives(id) ON DELETE CASCADE UNIQUE,

  -- Facebook IDs
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  rule_id TEXT,

  -- Config
  test_budget_cents INTEGER DEFAULT 2000,
  test_impressions_limit INTEGER DEFAULT 1000,
  objective TEXT DEFAULT 'whatsapp',

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  spend_cents INTEGER DEFAULT 0,
  ctr DECIMAL(10,4),
  cpl_cents INTEGER,

  -- Video
  video_views INTEGER DEFAULT 0,
  video_avg_watch_time_sec DECIMAL(10,2),

  -- AI analysis
  llm_score INTEGER,
  llm_verdict TEXT CHECK (llm_verdict IN ('excellent', 'good', 'average', 'poor')),
  llm_reasoning TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
