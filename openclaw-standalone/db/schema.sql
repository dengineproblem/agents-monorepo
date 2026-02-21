-- OpenClaw Standalone: Schema Template
-- Применяется к каждой клиентской БД при провизионинге:
--   docker exec -i openclaw-postgres psql -U postgres -d openclaw_<slug> < schema.sql

-- ============================================
-- 1. config — настройки (одна строка)
-- ============================================
CREATE TABLE config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Facebook
  fb_access_token TEXT,
  fb_page_id TEXT,
  fb_page_access_token TEXT,
  fb_ad_account_id TEXT,
  fb_instagram_id TEXT,
  fb_app_secret TEXT,
  fb_webhook_verify_token TEXT DEFAULT 'openclaw_leadgen_2026',

  -- Telegram
  telegram_bot_token TEXT,
  telegram_chat_id TEXT,

  -- Settings
  timezone TEXT DEFAULT 'Asia/Almaty',
  default_target_cpl_cents INTEGER DEFAULT 300,
  currency TEXT DEFAULT 'KZT',
  adset_creation_cutoff_hour INTEGER DEFAULT 18,
  min_budget_cents INTEGER DEFAULT 300,
  max_budget_cents INTEGER DEFAULT 10000,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO config (id) VALUES (1);

-- ============================================
-- 2. directions — направления кампаний
-- ============================================
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

-- ============================================
-- 3. direction_adsets — адсеты в направлениях
-- ============================================
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

-- ============================================
-- 4. creatives — загруженные креативы
-- ============================================
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

-- ============================================
-- 5. metrics_history — ежедневные метрики
-- ============================================
CREATE TABLE metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,

  ad_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,

  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  spend DECIMAL(10,2) DEFAULT 0,

  ctr DECIMAL(5,2),
  cpm DECIMAL(10,2),
  cpl DECIMAL(10,2),
  frequency DECIMAL(5,2),

  quality_ranking TEXT,
  engagement_rate_ranking TEXT,
  conversion_rate_ranking TEXT,

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

-- ============================================
-- 6. ad_creative_mapping — связь ad → creative
-- ============================================
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

-- ============================================
-- 7. creative_tests — A/B тесты
-- ============================================
CREATE TABLE creative_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID NOT NULL REFERENCES creatives(id) ON DELETE CASCADE UNIQUE,

  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  rule_id TEXT,

  test_budget_cents INTEGER DEFAULT 2000,
  test_impressions_limit INTEGER DEFAULT 1000,
  objective TEXT DEFAULT 'whatsapp',

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  spend_cents INTEGER DEFAULT 0,
  ctr DECIMAL(10,4),
  cpl_cents INTEGER,

  video_views INTEGER DEFAULT 0,
  video_avg_watch_time_sec DECIMAL(10,2),

  llm_score INTEGER,
  llm_verdict TEXT CHECK (llm_verdict IN ('excellent', 'good', 'average', 'poor')),
  llm_reasoning TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 8. scoring_history — Health Score
-- ============================================
CREATE TABLE scoring_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  adset_id TEXT NOT NULL,
  adset_name TEXT,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,

  health_score INTEGER NOT NULL,
  health_class TEXT NOT NULL
    CHECK (health_class IN ('very_good', 'good', 'neutral', 'slightly_bad', 'bad')),

  cpl_score INTEGER,
  trend_score INTEGER,
  diagnostics_score INTEGER,
  today_compensation INTEGER,
  volume_factor DECIMAL(3,2),

  ecpl_cents INTEGER,
  ctr DECIMAL(5,2),
  cpm DECIMAL(10,2),
  frequency DECIMAL(5,2),
  impressions INTEGER,
  spend_cents INTEGER,

  action_type TEXT CHECK (action_type IN ('budget_increase', 'budget_decrease', 'pause', 'resume', 'none')),
  action_details JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (adset_id, date)
);

CREATE INDEX idx_scoring_date ON scoring_history(date DESC);
CREATE INDEX idx_scoring_class ON scoring_history(health_class, date DESC);

-- ============================================
-- 9. leads — входящие лиды
-- ============================================
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name TEXT,
  phone TEXT,
  email TEXT,

  leadgen_id TEXT UNIQUE,
  ad_id TEXT,
  form_id TEXT,
  source_type TEXT DEFAULT 'lead_form'
    CHECK (source_type IN ('lead_form', 'whatsapp', 'website', 'manual')),

  creative_id UUID REFERENCES creatives(id) ON DELETE SET NULL,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,

  utm_source TEXT,
  utm_campaign TEXT,
  utm_medium TEXT,

  stage TEXT DEFAULT 'new_lead',
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_date ON leads(created_at DESC);
CREATE INDEX idx_leads_direction ON leads(direction_id);
CREATE INDEX idx_leads_stage ON leads(stage);

-- ============================================
-- 10. currency_rates — курс валют
-- ============================================
CREATE TABLE currency_rates (
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(12,4) NOT NULL,
  source VARCHAR(50) DEFAULT 'exchangerate-api',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (from_currency, to_currency)
);

INSERT INTO currency_rates (from_currency, to_currency, rate)
VALUES ('USD', 'KZT', 530.0);

-- ============================================
-- 11. scoring_executions — лог запусков скоринга
-- ============================================
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
