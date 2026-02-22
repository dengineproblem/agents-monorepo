-- OpenClaw Standalone: Full Schema (v2 — полный паритет с SaaS)
-- Применяется к каждой клиентской БД при провизионинге:
--   docker exec -i openclaw-postgres psql -U postgres -d openclaw_<slug> < schema.sql
--
-- 38 таблиц. Все CREATE TABLE IF NOT EXISTS, INSERT ON CONFLICT DO NOTHING.
-- Безопасно перезапускать.

-- ============================================
-- 1. config — настройки (одна строка)
-- ============================================
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Facebook
  fb_access_token TEXT,
  fb_page_id TEXT,
  fb_page_access_token TEXT,
  fb_ad_account_id TEXT,
  fb_instagram_id TEXT,
  fb_instagram_username TEXT,
  fb_app_secret TEXT,
  fb_webhook_verify_token TEXT DEFAULT 'openclaw_leadgen_2026',
  fb_business_id TEXT,
  facebook_pixel_id TEXT,
  ig_seed_audience_id TEXT,

  -- TikTok
  tiktok_access_token TEXT,
  tiktok_account_id TEXT,
  tiktok_business_id TEXT,
  tiktok_instant_page_id TEXT,

  -- AmoCRM
  amocrm_subdomain TEXT,
  amocrm_access_token TEXT,
  amocrm_refresh_token TEXT,
  amocrm_token_expires_at TIMESTAMPTZ,
  amocrm_client_id TEXT,
  amocrm_client_secret TEXT,

  -- Bitrix24
  bitrix24_domain TEXT,
  bitrix24_access_token TEXT,
  bitrix24_refresh_token TEXT,
  bitrix24_token_expires_at TIMESTAMPTZ,
  bitrix24_member_id TEXT,
  bitrix24_user_id INTEGER,
  bitrix24_qualification_fields JSONB,
  bitrix24_entity_type TEXT,
  bitrix24_connected_at TIMESTAMPTZ,

  -- WhatsApp Business API
  waba_phone_id TEXT,
  waba_access_token TEXT,
  waba_app_secret TEXT,

  -- Telegram
  telegram_bot_token TEXT,
  telegram_chat_id TEXT,
  telegram_chat_id_2 TEXT,
  telegram_chat_id_3 TEXT,
  telegram_chat_id_4 TEXT,

  -- AI Keys
  openai_api_key TEXT,
  gemini_api_key TEXT,
  anthropic_api_key TEXT,

  -- Business prompts
  prompt1 TEXT,
  prompt2 TEXT,
  prompt3 TEXT,
  prompt4 TEXT,

  -- Autopilot
  autopilot BOOLEAN DEFAULT false,
  autopilot_tiktok BOOLEAN DEFAULT false,
  brain_schedule TEXT,
  brain_mode TEXT,

  -- Onboarding
  onboarding_stage VARCHAR(30) DEFAULT 'registered',
  onboarding_tags JSONB DEFAULT '[]'::jsonb,

  -- Settings
  timezone TEXT DEFAULT 'Asia/Almaty',
  default_target_cpl_cents INTEGER DEFAULT 300,
  currency TEXT DEFAULT 'KZT',
  adset_creation_cutoff_hour INTEGER DEFAULT 18,
  min_budget_cents INTEGER DEFAULT 300,
  max_budget_cents INTEGER DEFAULT 10000,
  site_url TEXT,
  custom_audiences JSONB DEFAULT '[]'::jsonb,

  -- Integrations
  bizon_api_token TEXT,
  sendpulse_fields JSONB,
  webhook_url TEXT,

  -- SaaS pairing (chatbot, WhatsApp, CAPI через SaaS)
  saas_account_id UUID,
  saas_ad_account_id UUID,
  saas_db_url TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================
-- 2. whatsapp_phone_numbers — номера WhatsApp
-- ============================================
CREATE TABLE IF NOT EXISTS whatsapp_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  label TEXT,
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. directions — направления кампаний
-- ============================================
CREATE TABLE IF NOT EXISTS directions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms', 'app_installs', 'conversions', 'whatsapp_conversions')),
  platform TEXT DEFAULT 'facebook'
    CHECK (platform IN ('facebook', 'tiktok')),

  -- Facebook campaign
  fb_campaign_id TEXT,
  campaign_status TEXT DEFAULT 'ACTIVE'
    CHECK (campaign_status IN ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED')),

  -- Budget & KPIs
  daily_budget_cents INTEGER NOT NULL DEFAULT 1000,
  target_cpl_cents INTEGER NOT NULL DEFAULT 300,
  is_active BOOLEAN DEFAULT true,
  targeting JSONB,

  -- Key stage tracking
  key_stage TEXT,
  reached_key_stage BOOLEAN DEFAULT false,
  cta_type TEXT,

  -- WhatsApp linking
  whatsapp_phone_number_id UUID REFERENCES whatsapp_phone_numbers(id) ON DELETE SET NULL,

  -- CAPI
  capi_enabled BOOLEAN DEFAULT false,
  capi_source TEXT,
  capi_crm_type TEXT,
  capi_interest_fields JSONB,
  capi_qualified_fields JSONB,
  capi_scheduled_fields JSONB,

  -- Audience controls
  audience_controls_enabled BOOLEAN DEFAULT false,
  audience_controls_value TEXT,
  audience_controls_lookalike BOOLEAN DEFAULT false,

  -- TikTok
  tiktok_pixel_id TEXT,
  tiktok_identity_id TEXT,
  tiktok_campaign_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 4. direction_adsets — адсеты в направлениях
-- ============================================
CREATE TABLE IF NOT EXISTS direction_adsets (
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

CREATE INDEX IF NOT EXISTS idx_direction_adsets_active ON direction_adsets(direction_id) WHERE is_active = true;

-- ============================================
-- 5. direction_tiktok_adgroups — TikTok ad groups
-- ============================================
CREATE TABLE IF NOT EXISTS direction_tiktok_adgroups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  tiktok_adgroup_id TEXT NOT NULL,
  adgroup_name TEXT,
  daily_budget DECIMAL(10,2),
  status TEXT DEFAULT 'ENABLE'
    CHECK (status IN ('ENABLE', 'DISABLE', 'DELETE')),
  ads_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (direction_id, tiktok_adgroup_id)
);

-- ============================================
-- 6. generated_creatives — AI-сгенерированные креативы
-- ============================================
CREATE TABLE IF NOT EXISTS generated_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,

  -- Generated text content
  offer TEXT,
  bullets TEXT,
  profits TEXT,
  cta TEXT,

  -- Generated media
  image_url TEXT,
  image_url_4k TEXT,
  image_url_4x5 TEXT,
  carousel_data JSONB,
  media_type TEXT DEFAULT 'image'
    CHECK (media_type IN ('image', 'carousel')),
  visual_style TEXT,

  status TEXT DEFAULT 'generated'
    CHECK (status IN ('generated', 'uploaded_to_fb', 'archived')),

  -- AI metadata
  model TEXT,
  tokens_used INTEGER,
  processing_time_ms INTEGER,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 7. creatives — загруженные креативы
-- ============================================
CREATE TABLE IF NOT EXISTS creatives (
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

  -- TikTok
  tiktok_video_id TEXT,

  -- Media URLs
  image_url TEXT,
  image_url_4k TEXT,
  image_url_4x5 TEXT,
  thumbnail_url TEXT,
  cached_thumbnail_url TEXT,
  carousel_data JSONB,

  status TEXT DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,
  generated_creative_id UUID REFERENCES generated_creatives(id) ON DELETE SET NULL,
  creative_group_id UUID,
  transcription TEXT,

  -- State
  is_active BOOLEAN DEFAULT true,
  error_text TEXT,
  source TEXT DEFAULT 'upload'
    CHECK (source IN ('upload', 'generation', 'ai')),

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

CREATE INDEX IF NOT EXISTS idx_creatives_status ON creatives(status);
CREATE INDEX IF NOT EXISTS idx_creatives_direction ON creatives(direction_id);
CREATE INDEX IF NOT EXISTS idx_creatives_active ON creatives(is_active) WHERE is_active = true;

-- ============================================
-- 8. direction_creative_gallery — галерея креативов
-- ============================================
CREATE TABLE IF NOT EXISTS direction_creative_gallery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  creative_id UUID NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  is_pinned BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (direction_id, creative_id)
);

-- ============================================
-- 9. creative_gallery_drafts — черновики галереи
-- ============================================
CREATE TABLE IF NOT EXISTS creative_gallery_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  creative_id UUID NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (direction_id, creative_id)
);

-- ============================================
-- 10. metrics_history — ежедневные метрики
-- ============================================
CREATE TABLE IF NOT EXISTS metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  source TEXT DEFAULT 'facebook'
    CHECK (source IN ('facebook', 'tiktok')),

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

CREATE INDEX IF NOT EXISTS idx_metrics_date ON metrics_history(date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_adset_date ON metrics_history(adset_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_campaign ON metrics_history(campaign_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_source ON metrics_history(source, date DESC);

-- ============================================
-- 11. creative_metrics_history — метрики по креативам
-- ============================================
CREATE TABLE IF NOT EXISTS creative_metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  source TEXT DEFAULT 'facebook'
    CHECK (source IN ('facebook', 'tiktok')),

  ad_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,
  creative_id TEXT,
  user_creative_id UUID REFERENCES creatives(id) ON DELETE SET NULL,

  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  spend DECIMAL(10,2) DEFAULT 0,
  ctr DECIMAL(5,2),
  cpm DECIMAL(10,2),
  frequency DECIMAL(5,2),

  quality_ranking TEXT,
  engagement_rate_ranking TEXT,
  conversion_rate_ranking TEXT,

  video_plays INTEGER,
  video_play_rate DECIMAL(5,2),
  average_watch_time_seconds INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creative_metrics_date ON creative_metrics_history(date DESC);
CREATE INDEX IF NOT EXISTS idx_creative_metrics_creative ON creative_metrics_history(user_creative_id, date DESC);

-- ============================================
-- 12. ad_creative_mapping — связь ad → creative
-- ============================================
CREATE TABLE IF NOT EXISTS ad_creative_mapping (
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

CREATE INDEX IF NOT EXISTS idx_mapping_creative ON ad_creative_mapping(creative_id);

-- ============================================
-- 13. creative_tests — A/B тесты
-- ============================================
CREATE TABLE IF NOT EXISTS creative_tests (
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
-- 14. creative_scores — risk scores и predictions
-- ============================================
CREATE TABLE IF NOT EXISTS creative_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL CHECK (level IN ('creative', 'adset')),

  creative_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,
  name TEXT,
  date DATE NOT NULL,

  risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('Low', 'Medium', 'High')),

  prediction_trend TEXT CHECK (prediction_trend IN ('improving', 'stable', 'declining')),
  prediction_cpl_current DECIMAL(10,2),
  prediction_cpl_expected DECIMAL(10,2),
  prediction_change_pct DECIMAL(5,1),

  recommendations JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creative_scores_date ON creative_scores(date DESC);

-- ============================================
-- 15. scoring_history — Health Score
-- ============================================
CREATE TABLE IF NOT EXISTS scoring_history (
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

CREATE INDEX IF NOT EXISTS idx_scoring_date ON scoring_history(date DESC);
CREATE INDEX IF NOT EXISTS idx_scoring_class ON scoring_history(health_class, date DESC);

-- ============================================
-- 16. leads — входящие лиды
-- ============================================
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name TEXT,
  phone TEXT,
  email TEXT,
  message_preview TEXT,

  leadgen_id TEXT UNIQUE,
  ad_id TEXT,
  form_id TEXT,
  source_type TEXT DEFAULT 'lead_form'
    CHECK (source_type IN ('lead_form', 'whatsapp', 'website', 'manual', 'tiktok')),

  creative_id UUID REFERENCES creatives(id) ON DELETE SET NULL,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,
  chat_id TEXT,

  -- UTM tracking
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,

  -- CAPI tracking
  ctwa_clid TEXT,
  fbc TEXT,
  fbp TEXT,

  -- CRM integration
  amocrm_lead_id TEXT,
  amocrm_contact_id TEXT,
  bitrix24_lead_id TEXT,
  bitrix24_contact_id TEXT,
  bitrix24_deal_id TEXT,
  bitrix24_entity_type TEXT,

  -- Stage tracking
  stage TEXT DEFAULT 'new_lead',
  reached_key_stage BOOLEAN DEFAULT false,
  is_scheduled BOOLEAN DEFAULT false,
  needs_manual_match BOOLEAN DEFAULT false,
  is_delayed_stop BOOLEAN DEFAULT false,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_date ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_direction ON leads(direction_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_ctwa_clid ON leads(ctwa_clid) WHERE ctwa_clid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_leadgen ON leads(leadgen_id) WHERE leadgen_id IS NOT NULL;

-- ============================================
-- 17. sales — продажи
-- ============================================
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

  amount DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'KZT',
  product_name TEXT,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'refunded')),
  sale_date DATE,

  -- CRM links
  amocrm_deal_id TEXT,
  bitrix24_deal_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_lead ON sales(lead_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date DESC);

-- ============================================
-- 18. purchases — покупки / подписки
-- ============================================
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

  amount DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'KZT',
  product_name TEXT,
  status TEXT DEFAULT 'pending',

  amocrm_deal_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 19. currency_rates — курс валют
-- ============================================
CREATE TABLE IF NOT EXISTS currency_rates (
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(12,4) NOT NULL,
  source VARCHAR(50) DEFAULT 'exchangerate-api',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (from_currency, to_currency)
);

INSERT INTO currency_rates (from_currency, to_currency, rate)
VALUES ('USD', 'KZT', 530.0) ON CONFLICT DO NOTHING;

-- ============================================
-- 20. scoring_executions — лог запусков скоринга
-- ============================================
CREATE TABLE IF NOT EXISTS scoring_executions (
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

CREATE INDEX IF NOT EXISTS idx_scoring_exec_date ON scoring_executions(created_at DESC);

-- ============================================
-- 21. brain_executions — лог выполнений автопилота
-- ============================================
CREATE TABLE IF NOT EXISTS brain_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT,

  plan_json JSONB,
  actions_json JSONB,
  executor_response_json JSONB,
  report_text TEXT,

  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'error')),
  duration_ms INTEGER,
  platform TEXT DEFAULT 'facebook'
    CHECK (platform IN ('facebook', 'tiktok')),
  execution_mode TEXT,
  execution_hour INTEGER,
  actions_count INTEGER DEFAULT 0,
  actions_success_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_exec_date ON brain_executions(created_at DESC);

-- ============================================
-- 22. pending_brain_proposals — предложения semi-auto
-- ============================================
CREATE TABLE IF NOT EXISTS pending_brain_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  proposals JSONB NOT NULL DEFAULT '[]'::jsonb,
  context JSONB DEFAULT '{}'::jsonb,
  proposals_count INTEGER DEFAULT 0,

  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'partial', 'approved', 'rejected', 'expired')),

  notification_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
  processed_at TIMESTAMPTZ,
  executed_indices INTEGER[] DEFAULT '{}'
);

-- ============================================
-- 23. capi_settings — настройки Conversion API
-- ============================================
CREATE TABLE IF NOT EXISTS capi_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL
    CHECK (channel IN ('whatsapp', 'lead_forms', 'site')),

  pixel_id TEXT NOT NULL,
  capi_access_token TEXT,
  capi_source TEXT NOT NULL
    CHECK (capi_source IN ('whatsapp', 'crm')),

  capi_crm_type TEXT
    CHECK (capi_crm_type IN ('amocrm', 'bitrix24')),
  capi_interest_fields JSONB DEFAULT '[]'::jsonb,
  capi_qualified_fields JSONB DEFAULT '[]'::jsonb,
  capi_scheduled_fields JSONB DEFAULT '[]'::jsonb,

  ai_l2_description TEXT,
  ai_l3_description TEXT,
  ai_generated_prompt TEXT,

  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (channel)
);

-- ============================================
-- 24. capi_events_log — лог событий CAPI
-- ============================================
CREATE TABLE IF NOT EXISTS capi_events_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,

  event_name TEXT NOT NULL,
  event_level INTEGER NOT NULL CHECK (event_level IN (1, 2, 3)),

  pixel_id TEXT NOT NULL,
  ctwa_clid TEXT,
  event_time TIMESTAMPTZ NOT NULL,
  event_id TEXT,

  capi_response JSONB,
  capi_status TEXT
    CHECK (capi_status IN ('success', 'error', 'skipped')),
  capi_error TEXT,
  contact_phone TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capi_events_date ON capi_events_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capi_events_lead ON capi_events_log(lead_id);

-- ============================================
-- 25. ai_bot_configurations — настройки AI чатбота
-- ============================================
CREATE TABLE IF NOT EXISTS ai_bot_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Мой бот',
  is_active BOOLEAN DEFAULT true,

  -- AI settings
  system_prompt TEXT DEFAULT '',
  temperature NUMERIC(3,2) DEFAULT 0.24,
  model TEXT DEFAULT 'gpt-4o',

  -- Message history limits
  history_token_limit INTEGER DEFAULT 8000,
  history_message_limit INTEGER,
  history_time_limit_hours INTEGER,

  -- Message buffer
  message_buffer_seconds INTEGER DEFAULT 7,

  -- Operator control
  operator_pause_enabled BOOLEAN DEFAULT true,
  operator_pause_ignore_first_message BOOLEAN DEFAULT true,
  operator_auto_resume_hours INTEGER DEFAULT 0,
  operator_auto_resume_minutes INTEGER DEFAULT 0,
  operator_pause_exceptions TEXT[] DEFAULT '{}',

  -- Stop/Resume phrases
  stop_phrases TEXT[] DEFAULT '{}',
  resume_phrases TEXT[] DEFAULT '{}',

  -- Message splitting
  split_messages BOOLEAN DEFAULT false,
  split_max_length INTEGER DEFAULT 500,
  clean_markdown BOOLEAN DEFAULT true,

  -- Schedule
  schedule_enabled BOOLEAN DEFAULT false,
  schedule_hours_start INTEGER DEFAULT 9,
  schedule_hours_end INTEGER DEFAULT 18,
  schedule_days INTEGER[] DEFAULT '{1,2,3,4,5}',
  timezone TEXT DEFAULT 'Asia/Almaty',
  pass_current_datetime BOOLEAN DEFAULT true,

  -- Media handling
  voice_recognition_enabled BOOLEAN DEFAULT false,
  voice_default_response TEXT,
  image_recognition_enabled BOOLEAN DEFAULT false,
  image_default_response TEXT,
  document_recognition_enabled BOOLEAN DEFAULT false,
  document_default_response TEXT,
  file_handling_mode TEXT DEFAULT 'ignore',
  file_default_response TEXT,

  -- Messages
  start_message TEXT,
  error_message TEXT,
  custom_openai_api_key TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 26. ai_bot_functions — функции бота
-- ============================================
CREATE TABLE IF NOT EXISTS ai_bot_functions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES ai_bot_configurations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  parameters JSONB DEFAULT '{}'::jsonb,
  handler_type TEXT NOT NULL,
  handler_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 27. whatsapp_instances — подключения Evolution API
-- ============================================
CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name TEXT NOT NULL UNIQUE,
  instance_id TEXT UNIQUE,
  phone_number TEXT,

  status TEXT DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connecting', 'connected', 'error')),
  qr_code TEXT,
  last_connected_at TIMESTAMPTZ,
  error_message TEXT,

  ai_bot_id UUID REFERENCES ai_bot_configurations(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 28. messages — сообщения WhatsApp/чат
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
  chat_id TEXT,

  role TEXT NOT NULL
    CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT,
  media_type TEXT,
  media_url TEXT,

  -- Attribution
  source_id TEXT,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,
  creative_id UUID REFERENCES creatives(id) ON DELETE SET NULL,

  -- Raw webhook data
  raw_data JSONB,

  -- AI processing
  ai_processed BOOLEAN DEFAULT false,
  ai_response_id UUID,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_instance ON messages(instance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);

-- ============================================
-- 29. amocrm_sync_log — лог синхронизации AmoCRM
-- ============================================
CREATE TABLE IF NOT EXISTS amocrm_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,

  amocrm_lead_id TEXT,
  amocrm_contact_id TEXT,
  amocrm_deal_id TEXT,

  sync_type TEXT NOT NULL
    CHECK (sync_type IN ('lead_to_amocrm', 'contact_to_amocrm', 'deal_from_amocrm', 'lead_from_amocrm')),
  sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('success', 'failed', 'pending', 'retrying')),

  request_json JSONB,
  response_json JSONB,
  error_message TEXT,
  error_code TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amocrm_sync_date ON amocrm_sync_log(created_at DESC);

-- ============================================
-- 30. bitrix24_pipeline_stages — стадии воронки Bitrix24
-- ============================================
CREATE TABLE IF NOT EXISTS bitrix24_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id INTEGER,
  category_name TEXT,
  status_id TEXT,
  status_name TEXT,
  status_color TEXT,
  status_sort INTEGER,
  status_semantics TEXT,
  entity_type TEXT DEFAULT 'deal'
    CHECK (entity_type IN ('lead', 'deal')),

  is_qualified_stage BOOLEAN DEFAULT false,
  is_success_stage BOOLEAN DEFAULT false,
  is_fail_stage BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 31. bitrix24_status_history — история смены статусов
-- ============================================
CREATE TABLE IF NOT EXISTS bitrix24_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

  bitrix24_lead_id TEXT,
  bitrix24_deal_id TEXT,
  entity_type TEXT DEFAULT 'deal'
    CHECK (entity_type IN ('lead', 'deal')),

  from_status_id TEXT,
  to_status_id TEXT,
  from_category_id INTEGER,
  to_category_id INTEGER,

  webhook_data JSONB,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bitrix_status_date ON bitrix24_status_history(changed_at DESC);

-- ============================================
-- 32. bitrix24_sync_log — лог синхронизации Bitrix24
-- ============================================
CREATE TABLE IF NOT EXISTS bitrix24_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,

  bitrix24_lead_id TEXT,
  bitrix24_deal_id TEXT,
  bitrix24_contact_id TEXT,

  sync_type TEXT NOT NULL
    CHECK (sync_type IN ('lead_to_bitrix', 'contact_to_bitrix', 'deal_to_bitrix', 'lead_from_bitrix', 'deal_from_bitrix', 'contact_from_bitrix', 'status_update')),
  sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('success', 'failed', 'pending', 'retrying')),

  request_json JSONB,
  response_json JSONB,
  error_message TEXT,
  error_code TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bitrix_sync_date ON bitrix24_sync_log(created_at DESC);

-- ============================================
-- 33. user_notifications — уведомления
-- ============================================
CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  telegram_sent BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_date ON user_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON user_notifications(is_read) WHERE is_read = false;

-- ============================================
-- 34. notification_settings — настройки уведомлений
-- ============================================
CREATE TABLE IF NOT EXISTS notification_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  daily_limit INTEGER DEFAULT 3,
  weekly_limit INTEGER DEFAULT 10,
  send_hour INTEGER DEFAULT 4,
  type_cooldowns JSONB,
  enabled_types JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO notification_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================
-- 35. notification_history — лог доставки
-- ============================================
CREATE TABLE IF NOT EXISTS notification_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL
    CHECK (channel IN ('telegram', 'in_app', 'both')),
  telegram_sent BOOLEAN DEFAULT false,
  in_app_created BOOLEAN DEFAULT false,
  notification_id UUID REFERENCES user_notifications(id) ON DELETE SET NULL,
  message_preview TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 36. onboarding_history — история стадий онбординга
-- ============================================
CREATE TABLE IF NOT EXISTS onboarding_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_from VARCHAR(30),
  stage_to VARCHAR(30) NOT NULL,
  change_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 37. business_memory — бизнес-контекст
-- ============================================
CREATE TABLE IF NOT EXISTS business_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 38. webinar_attendees — участники вебинаров
-- ============================================
CREATE TABLE IF NOT EXISTS webinar_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id TEXT NOT NULL,
  webinar_title TEXT,
  webinar_date TIMESTAMPTZ,

  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  username TEXT,
  email TEXT,

  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  watch_duration_sec INTEGER,
  attended BOOLEAN DEFAULT true,

  -- UTM tracking
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  url_marker TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webinar_date ON webinar_attendees(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webinar_lead ON webinar_attendees(lead_id);
