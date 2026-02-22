-- OpenClaw Standalone: PostgreSQL init
-- Этот файл выполняется один раз при создании контейнера.
-- Таблицы создаются per-client через scripts/create-client.sh + schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- waba_phone_mapping — маршрутизация WABA webhooks
-- В SHARED БД (openclaw), не per-tenant.
-- Связывает Meta phone_number_id → tenant slug.
-- ============================================
CREATE TABLE IF NOT EXISTS waba_phone_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waba_phone_id TEXT NOT NULL UNIQUE,        -- Meta Phone Number ID (из webhook metadata)
  slug TEXT NOT NULL,                         -- tenant slug → openclaw_{slug}
  phone_number TEXT,                          -- человекочитаемый номер (+77001234567)
  waba_app_secret TEXT,                       -- App Secret для HMAC верификации (per-number)
  waba_access_token TEXT,                     -- Access Token для Cloud API
  waba_business_account_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waba_mapping_phone_id ON waba_phone_mapping(waba_phone_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_waba_mapping_slug ON waba_phone_mapping(slug);
