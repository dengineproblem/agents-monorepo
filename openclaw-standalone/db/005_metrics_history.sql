CREATE TABLE metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,

  -- Facebook IDs
  ad_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,

  -- Core metrics
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  spend DECIMAL(10,2) DEFAULT 0,

  -- Computed
  ctr DECIMAL(5,2),
  cpm DECIMAL(10,2),
  cpl DECIMAL(10,2),
  frequency DECIMAL(5,2),

  -- Facebook diagnostics
  quality_ranking TEXT,
  engagement_rate_ranking TEXT,
  conversion_rate_ranking TEXT,

  -- Video
  video_views INTEGER,
  video_views_p25 INTEGER,
  video_views_p50 INTEGER,
  video_views_p75 INTEGER,
  video_views_p95 INTEGER,

  creative_id UUID REFERENCES creatives(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (adset_id, date)
);

CREATE INDEX idx_metrics_date ON metrics_history(date DESC);
CREATE INDEX idx_metrics_adset_date ON metrics_history(adset_id, date DESC);
CREATE INDEX idx_metrics_campaign ON metrics_history(campaign_id, date DESC);
