-- Migration 057: Create ad_accounts table for multi-account functionality
-- This table stores per-business advertising account settings
-- SAFE: Only creates new table, no changes to existing tables

CREATE TABLE ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Basic info
  name TEXT NOT NULL,
  username TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,

  -- Tariff settings
  tarif VARCHAR(50) DEFAULT 'ai_target',
  tarif_expires DATE,
  tarif_renewal_cost NUMERIC(10, 2),

  -- Facebook credentials (user enters IDs, admin fills access_token)
  fb_ad_account_id TEXT,
  fb_page_id TEXT,
  fb_instagram_id TEXT,
  fb_instagram_username TEXT,
  fb_access_token TEXT,
  fb_business_id VARCHAR(100),
  ig_seed_audience_id TEXT,

  -- TikTok credentials (OAuth flow)
  tiktok_account_id TEXT,
  tiktok_business_id TEXT,
  tiktok_access_token TEXT,

  -- AI Prompts (per-business customization)
  prompt1 TEXT,
  prompt2 TEXT,
  prompt3 TEXT,
  prompt4 TEXT,

  -- Telegram notification IDs
  telegram_id TEXT,
  telegram_id_2 TEXT,
  telegram_id_3 TEXT,
  telegram_id_4 TEXT,

  -- API Keys (per-business AI services)
  openai_api_key TEXT,
  gemini_api_key TEXT,

  -- AmoCRM integration (OAuth)
  amocrm_subdomain TEXT,
  amocrm_access_token TEXT,
  amocrm_refresh_token TEXT,
  amocrm_token_expires_at TIMESTAMPTZ,
  amocrm_client_id TEXT,
  amocrm_client_secret TEXT,

  -- Custom audiences
  custom_audiences JSONB DEFAULT '[]'::jsonb,

  -- Status tracking
  connection_status TEXT DEFAULT 'pending',
  last_error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by user
CREATE INDEX idx_ad_accounts_user_account_id ON ad_accounts(user_account_id);

-- Index for finding default account
CREATE INDEX idx_ad_accounts_default ON ad_accounts(user_account_id, is_default) WHERE is_default = true;

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_ad_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ad_accounts_updated_at
  BEFORE UPDATE ON ad_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_ad_accounts_updated_at();

-- Trigger: enforce max 5 accounts per user
CREATE OR REPLACE FUNCTION check_max_ad_accounts()
RETURNS TRIGGER AS $$
DECLARE
  account_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO account_count
  FROM ad_accounts
  WHERE user_account_id = NEW.user_account_id;

  IF account_count >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 advertising accounts allowed per user';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_max_ad_accounts
  BEFORE INSERT ON ad_accounts
  FOR EACH ROW
  EXECUTE FUNCTION check_max_ad_accounts();

-- Trigger: ensure only one default account per user
CREATE OR REPLACE FUNCTION ensure_single_default_ad_account()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE ad_accounts
    SET is_default = false
    WHERE user_account_id = NEW.user_account_id
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_single_default_ad_account
  BEFORE INSERT OR UPDATE OF is_default ON ad_accounts
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION ensure_single_default_ad_account();

-- Comments
COMMENT ON TABLE ad_accounts IS 'Рекламные аккаунты для мультиаккаунтности. Каждый пользователь может иметь до 5 аккаунтов.';
COMMENT ON COLUMN ad_accounts.is_default IS 'Аккаунт по умолчанию. Только один на пользователя.';
COMMENT ON COLUMN ad_accounts.fb_access_token IS 'Заполняется администратором вручную';
COMMENT ON COLUMN ad_accounts.custom_audiences IS 'JSON массив кастомных аудиторий [{id, name}]';
