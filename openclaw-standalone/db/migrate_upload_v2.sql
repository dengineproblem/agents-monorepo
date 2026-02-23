-- Migration: Upload Service v2
-- Добавляет fb_creative_id в creatives, создаёт default_ad_settings
-- Выполнять для каждого клиента:
--   SLUG=test
--   docker exec -i openclaw-postgres psql -U postgres -d "openclaw_${SLUG}" < db/migrate_upload_v2.sql

-- 1. creatives: unified fb_creative_id
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS fb_creative_id TEXT;

-- 2. default_ad_settings — настройки креативов по направлению (как в основном проекте)
CREATE TABLE IF NOT EXISTS default_ad_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE UNIQUE,
  description TEXT DEFAULT 'Напишите нам, чтобы узнать подробности',
  client_question TEXT DEFAULT 'Здравствуйте! Хочу узнать об этом подробнее.',
  site_url TEXT,
  utm_tag TEXT,
  lead_form_id TEXT,
  app_store_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
