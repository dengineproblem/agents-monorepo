CREATE TABLE ad_creative_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id TEXT NOT NULL UNIQUE,
  creative_id UUID NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,
  adset_id TEXT,
  campaign_id TEXT,
  fb_creative_id TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mapping_creative ON ad_creative_mapping(creative_id);
