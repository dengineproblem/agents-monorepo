-- Migration: Upload Service v2
-- Добавляет fb_creative_id в creatives, доп. поля в directions
-- Выполнять для каждого клиента:
--   SLUG=test
--   docker exec -i openclaw-postgres psql -U postgres -d "openclaw_${SLUG}" < db/migrate_upload_v2.sql

-- 1. creatives: unified fb_creative_id
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS fb_creative_id TEXT;

-- 2. directions: creative creation settings
ALTER TABLE directions ADD COLUMN IF NOT EXISTS description TEXT DEFAULT 'Напишите нам, чтобы узнать подробности';
ALTER TABLE directions ADD COLUMN IF NOT EXISTS site_url TEXT;
ALTER TABLE directions ADD COLUMN IF NOT EXISTS lead_form_id TEXT;
