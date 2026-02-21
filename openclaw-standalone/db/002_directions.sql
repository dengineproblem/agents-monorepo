CREATE TABLE directions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms', 'app_installs')),
  fb_campaign_id TEXT,
  campaign_status TEXT DEFAULT 'ACTIVE'
    CHECK (campaign_status IN ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED')),
  daily_budget_cents INTEGER NOT NULL DEFAULT 1000,
  target_cpl_cents INTEGER NOT NULL DEFAULT 300,
  is_active BOOLEAN DEFAULT true,
  targeting JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
