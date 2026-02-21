CREATE TABLE creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  media_type TEXT NOT NULL DEFAULT 'video'
    CHECK (media_type IN ('video', 'image', 'carousel')),
  file_path TEXT,

  -- Facebook IDs
  fb_video_id TEXT,
  fb_image_hash TEXT,
  fb_creative_id_whatsapp TEXT,
  fb_creative_id_instagram TEXT,
  fb_creative_id_site_leads TEXT,
  fb_creative_id_lead_forms TEXT,

  status TEXT DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,
  transcription TEXT,
  thumbnail_url TEXT,

  -- Cached performance
  total_spend_cents INTEGER DEFAULT 0,
  total_leads INTEGER DEFAULT 0,
  total_impressions INTEGER DEFAULT 0,
  avg_cpl_cents INTEGER,
  avg_ctr DECIMAL(5,2),
  performance_class TEXT
    CHECK (performance_class IN ('strong', 'medium', 'new', 'weak')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_creatives_status ON creatives(status);
CREATE INDEX idx_creatives_direction ON creatives(direction_id);
