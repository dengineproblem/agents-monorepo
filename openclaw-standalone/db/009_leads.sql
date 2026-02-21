CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contact
  name TEXT,
  phone TEXT,
  email TEXT,

  -- Facebook source
  leadgen_id TEXT UNIQUE,
  ad_id TEXT,
  form_id TEXT,
  source_type TEXT DEFAULT 'lead_form'
    CHECK (source_type IN ('lead_form', 'whatsapp', 'website', 'manual')),

  -- Attribution
  creative_id UUID REFERENCES creatives(id) ON DELETE SET NULL,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,

  -- UTM
  utm_source TEXT,
  utm_campaign TEXT,
  utm_medium TEXT,

  -- Status
  stage TEXT DEFAULT 'new_lead',
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_date ON leads(created_at DESC);
CREATE INDEX idx_leads_direction ON leads(direction_id);
CREATE INDEX idx_leads_stage ON leads(stage);
