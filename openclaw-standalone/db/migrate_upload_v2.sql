-- Migration: Upload Service v2
-- Добавляет fb_creative_id в creatives, создаёт default_ad_settings
-- Выполнять для каждого клиента:
--   SLUG=test
--   docker exec -i openclaw-postgres psql -U postgres -d "openclaw_${SLUG}" < db/migrate_upload_v2.sql

-- 1. creatives: unified fb_creative_id
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS fb_creative_id TEXT;

-- 2. default_ad_settings — настройки креативов (структура из основного проекта)
CREATE TABLE IF NOT EXISTS default_ad_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID REFERENCES directions(id) ON DELETE CASCADE UNIQUE,
  campaign_goal TEXT DEFAULT 'whatsapp',
  cities JSONB DEFAULT '["KZ"]',
  age_min INTEGER DEFAULT 18,
  age_max INTEGER DEFAULT 65,
  gender TEXT DEFAULT 'all',
  description TEXT DEFAULT 'Напишите нам, чтобы узнать подробности',
  client_question TEXT DEFAULT 'Здравствуйте! Хочу узнать об этом подробнее.',
  instagram_url TEXT,
  site_url TEXT,
  pixel_id TEXT,
  utm_tag TEXT DEFAULT 'utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}',
  lead_form_id TEXT,
  app_id TEXT,
  app_store_url TEXT,
  is_skadnetwork_attribution BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
