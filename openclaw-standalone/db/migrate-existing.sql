-- OpenClaw Standalone: Migration for existing client databases
-- Обновляет БД клиентов, созданных до schema v2
-- Безопасно перезапускать — все операции идемпотентные.
--
-- Применение к одному клиенту:
--   docker exec -i openclaw-postgres psql -U postgres -d openclaw_<slug> < migrate-existing.sql
--
-- Применение ко всем клиентам:
--   for db in $(docker exec openclaw-postgres psql -U postgres -t -c "SELECT datname FROM pg_database WHERE datname LIKE 'openclaw_%' AND datname != 'openclaw'"); do
--     echo "Migrating $db...";
--     docker exec -i openclaw-postgres psql -U postgres -d "$db" < migrate-existing.sql;
--   done

-- ============================================
-- A. Расширение config
-- ============================================
ALTER TABLE config ADD COLUMN IF NOT EXISTS fb_instagram_username TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS fb_business_id TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS facebook_pixel_id TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS ig_seed_audience_id TEXT;

-- TikTok
ALTER TABLE config ADD COLUMN IF NOT EXISTS tiktok_access_token TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS tiktok_account_id TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS tiktok_business_id TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS tiktok_instant_page_id TEXT;

-- AmoCRM
ALTER TABLE config ADD COLUMN IF NOT EXISTS amocrm_subdomain TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS amocrm_access_token TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS amocrm_refresh_token TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS amocrm_token_expires_at TIMESTAMPTZ;
ALTER TABLE config ADD COLUMN IF NOT EXISTS amocrm_client_id TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS amocrm_client_secret TEXT;

-- Bitrix24
ALTER TABLE config ADD COLUMN IF NOT EXISTS bitrix24_domain TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS bitrix24_access_token TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS bitrix24_refresh_token TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS bitrix24_token_expires_at TIMESTAMPTZ;
ALTER TABLE config ADD COLUMN IF NOT EXISTS bitrix24_member_id TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS bitrix24_user_id INTEGER;
ALTER TABLE config ADD COLUMN IF NOT EXISTS bitrix24_qualification_fields JSONB;
ALTER TABLE config ADD COLUMN IF NOT EXISTS bitrix24_entity_type TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS bitrix24_connected_at TIMESTAMPTZ;

-- WhatsApp Business API
ALTER TABLE config ADD COLUMN IF NOT EXISTS waba_phone_id TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS waba_access_token TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS waba_app_secret TEXT;

-- Telegram extra
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_chat_id_2 TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_chat_id_3 TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_chat_id_4 TEXT;

-- AI Keys
ALTER TABLE config ADD COLUMN IF NOT EXISTS openai_api_key TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;

-- Business prompts
ALTER TABLE config ADD COLUMN IF NOT EXISTS prompt1 TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS prompt2 TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS prompt3 TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS prompt4 TEXT;

-- Autopilot
ALTER TABLE config ADD COLUMN IF NOT EXISTS autopilot BOOLEAN DEFAULT false;
ALTER TABLE config ADD COLUMN IF NOT EXISTS autopilot_tiktok BOOLEAN DEFAULT false;
ALTER TABLE config ADD COLUMN IF NOT EXISTS brain_schedule TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS brain_mode TEXT;

-- Onboarding
ALTER TABLE config ADD COLUMN IF NOT EXISTS onboarding_stage VARCHAR(30) DEFAULT 'registered';
ALTER TABLE config ADD COLUMN IF NOT EXISTS onboarding_tags JSONB DEFAULT '[]'::jsonb;

-- Other
ALTER TABLE config ADD COLUMN IF NOT EXISTS site_url TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS custom_audiences JSONB DEFAULT '[]'::jsonb;
ALTER TABLE config ADD COLUMN IF NOT EXISTS bizon_api_token TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS sendpulse_fields JSONB;
ALTER TABLE config ADD COLUMN IF NOT EXISTS webhook_url TEXT;

-- SaaS pairing
ALTER TABLE config ADD COLUMN IF NOT EXISTS saas_account_id UUID;
ALTER TABLE config ADD COLUMN IF NOT EXISTS saas_ad_account_id UUID;
ALTER TABLE config ADD COLUMN IF NOT EXISTS saas_db_url TEXT;

-- ============================================
-- B. Расширение directions
-- ============================================
ALTER TABLE directions ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'facebook';
ALTER TABLE directions ADD COLUMN IF NOT EXISTS key_stage TEXT;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS reached_key_stage BOOLEAN DEFAULT false;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS cta_type TEXT;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS capi_enabled BOOLEAN DEFAULT false;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS capi_source TEXT;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS capi_crm_type TEXT;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS capi_interest_fields JSONB;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS capi_qualified_fields JSONB;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS capi_scheduled_fields JSONB;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS audience_controls_enabled BOOLEAN DEFAULT false;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS audience_controls_value TEXT;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS audience_controls_lookalike BOOLEAN DEFAULT false;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS tiktok_pixel_id TEXT;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS tiktok_identity_id TEXT;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS tiktok_campaign_id TEXT;

-- Add objective values (safe — CHECK constraint won't be altered, only added if missing)
-- Expand objective CHECK: drop old, add new
DO $$
BEGIN
  ALTER TABLE directions DROP CONSTRAINT IF EXISTS directions_objective_check;
  ALTER TABLE directions ADD CONSTRAINT directions_objective_check
    CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms', 'app_installs', 'conversions', 'whatsapp_conversions'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================
-- C. Расширение leads
-- ============================================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS message_preview TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_term TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_content TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ctwa_clid TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fbc TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fbp TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS chat_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS amocrm_lead_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS amocrm_contact_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS bitrix24_lead_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS bitrix24_contact_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS bitrix24_deal_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS bitrix24_entity_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS reached_key_stage BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_manual_match BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_delayed_stop BOOLEAN DEFAULT false;

-- Expand source_type CHECK
DO $$
BEGIN
  ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_type_check;
  ALTER TABLE leads ADD CONSTRAINT leads_source_type_check
    CHECK (source_type IN ('lead_form', 'whatsapp', 'website', 'manual', 'tiktok'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- New indexes
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_ctwa_clid ON leads(ctwa_clid) WHERE ctwa_clid IS NOT NULL;

-- ============================================
-- D. Расширение creatives
-- ============================================
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS image_url_4k TEXT;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS image_url_4x5 TEXT;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS cached_thumbnail_url TEXT;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS carousel_data JSONB;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS tiktok_video_id TEXT;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS creative_group_id UUID;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS error_text TEXT;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'upload';

CREATE INDEX IF NOT EXISTS idx_creatives_active ON creatives(is_active) WHERE is_active = true;

-- ============================================
-- E. Расширение metrics_history
-- ============================================
ALTER TABLE metrics_history ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'facebook';

CREATE INDEX IF NOT EXISTS idx_metrics_source ON metrics_history(source, date DESC);

-- ============================================
-- F. Новые таблицы (whatsapp_phone_numbers нужна до directions FK)
-- ============================================

-- whatsapp_phone_numbers
CREATE TABLE IF NOT EXISTS whatsapp_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  label TEXT,
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- FK для directions (если колонка ещё не существует)
ALTER TABLE directions ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id UUID REFERENCES whatsapp_phone_numbers(id) ON DELETE SET NULL;

-- direction_tiktok_adgroups
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

-- generated_creatives
CREATE TABLE IF NOT EXISTS generated_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,
  offer TEXT,
  bullets TEXT,
  profits TEXT,
  cta TEXT,
  image_url TEXT,
  image_url_4k TEXT,
  image_url_4x5 TEXT,
  carousel_data JSONB,
  media_type TEXT DEFAULT 'image'
    CHECK (media_type IN ('image', 'carousel')),
  visual_style TEXT,
  status TEXT DEFAULT 'generated'
    CHECK (status IN ('generated', 'uploaded_to_fb', 'archived')),
  model TEXT,
  tokens_used INTEGER,
  processing_time_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- FK для creatives → generated_creatives
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS generated_creative_id UUID REFERENCES generated_creatives(id) ON DELETE SET NULL;

-- direction_creative_gallery
CREATE TABLE IF NOT EXISTS direction_creative_gallery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  creative_id UUID NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  is_pinned BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (direction_id, creative_id)
);

-- creative_gallery_drafts
CREATE TABLE IF NOT EXISTS creative_gallery_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  creative_id UUID NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (direction_id, creative_id)
);

-- creative_metrics_history
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

-- creative_scores
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

-- brain_executions
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

-- pending_brain_proposals
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

-- sales
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  amount DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'KZT',
  product_name TEXT,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'refunded')),
  sale_date DATE,
  amocrm_deal_id TEXT,
  bitrix24_deal_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_lead ON sales(lead_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date DESC);

-- purchases
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

-- capi_settings
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

-- capi_events_log
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

-- ai_bot_configurations
CREATE TABLE IF NOT EXISTS ai_bot_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Мой бот',
  is_active BOOLEAN DEFAULT true,
  system_prompt TEXT DEFAULT '',
  temperature NUMERIC(3,2) DEFAULT 0.24,
  model TEXT DEFAULT 'gpt-4o',
  history_token_limit INTEGER DEFAULT 8000,
  history_message_limit INTEGER,
  history_time_limit_hours INTEGER,
  message_buffer_seconds INTEGER DEFAULT 7,
  operator_pause_enabled BOOLEAN DEFAULT true,
  operator_pause_ignore_first_message BOOLEAN DEFAULT true,
  operator_auto_resume_hours INTEGER DEFAULT 0,
  operator_auto_resume_minutes INTEGER DEFAULT 0,
  operator_pause_exceptions TEXT[] DEFAULT '{}',
  stop_phrases TEXT[] DEFAULT '{}',
  resume_phrases TEXT[] DEFAULT '{}',
  split_messages BOOLEAN DEFAULT false,
  split_max_length INTEGER DEFAULT 500,
  clean_markdown BOOLEAN DEFAULT true,
  schedule_enabled BOOLEAN DEFAULT false,
  schedule_hours_start INTEGER DEFAULT 9,
  schedule_hours_end INTEGER DEFAULT 18,
  schedule_days INTEGER[] DEFAULT '{1,2,3,4,5}',
  timezone TEXT DEFAULT 'Asia/Almaty',
  pass_current_datetime BOOLEAN DEFAULT true,
  voice_recognition_enabled BOOLEAN DEFAULT false,
  voice_default_response TEXT,
  image_recognition_enabled BOOLEAN DEFAULT false,
  image_default_response TEXT,
  document_recognition_enabled BOOLEAN DEFAULT false,
  document_default_response TEXT,
  file_handling_mode TEXT DEFAULT 'ignore',
  file_default_response TEXT,
  start_message TEXT,
  error_message TEXT,
  custom_openai_api_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ai_bot_functions
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

-- whatsapp_instances
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

-- messages
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
  chat_id TEXT,
  role TEXT NOT NULL
    CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT,
  media_type TEXT,
  media_url TEXT,
  source_id TEXT,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,
  creative_id UUID REFERENCES creatives(id) ON DELETE SET NULL,
  raw_data JSONB,
  ai_processed BOOLEAN DEFAULT false,
  ai_response_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_instance ON messages(instance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);

-- amocrm_sync_log
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

-- bitrix24_pipeline_stages
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

-- bitrix24_status_history
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

-- bitrix24_sync_log
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

-- user_notifications
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

-- notification_settings
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

-- notification_history
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

-- onboarding_history
CREATE TABLE IF NOT EXISTS onboarding_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_from VARCHAR(30),
  stage_to VARCHAR(30) NOT NULL,
  change_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- business_memory
CREATE TABLE IF NOT EXISTS business_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- webinar_attendees
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

-- Done!
SELECT 'Migration completed. New table count: ' || count(*) FROM information_schema.tables WHERE table_schema = 'public';
