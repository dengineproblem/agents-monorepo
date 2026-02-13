-- Migration 208: Create capi_settings table
-- Вынос CAPI настроек из account_directions в отдельную таблицу
-- Один channel (whatsapp/lead_forms/site) на ad_account

CREATE TABLE IF NOT EXISTS capi_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Привязка: multi-account → ad_accounts.id, legacy → user_accounts.id
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  account_id UUID REFERENCES ad_accounts(id) ON DELETE CASCADE,  -- NULL для legacy single-account

  -- Канал CAPI
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'lead_forms', 'site')),

  -- Pixel + access token (per-channel)
  pixel_id TEXT NOT NULL,
  capi_access_token TEXT,  -- pixel-specific token из Events Manager; если NULL → resolve из ad_accounts/user_accounts

  -- Источник квалификации
  capi_source TEXT NOT NULL CHECK (capi_source IN ('whatsapp', 'crm')),

  -- CRM конфигурация (если capi_source = 'crm')
  capi_crm_type TEXT CHECK (capi_crm_type IN ('amocrm', 'bitrix24')),
  capi_interest_fields JSONB DEFAULT '[]'::jsonb,   -- L1: Contact
  capi_qualified_fields JSONB DEFAULT '[]'::jsonb,  -- L2: Schedule
  capi_scheduled_fields JSONB DEFAULT '[]'::jsonb,  -- L3: StartTrial

  -- WhatsApp AI конфигурация (если capi_source = 'whatsapp')
  ai_l2_description TEXT,       -- свободный текст: кого считать квалифицированным (L2)
  ai_l3_description TEXT,       -- свободный текст: как понять что клиент записался (L3)
  ai_generated_prompt TEXT,     -- автоматически сгенерированный промпт для AI-анализа

  -- Metadata
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Один channel на аккаунт (учитываем NULL account_id для legacy)
  CONSTRAINT unique_capi_channel_per_account
    UNIQUE NULLS NOT DISTINCT (user_account_id, account_id, channel)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_capi_settings_user_account
  ON capi_settings(user_account_id, account_id);

CREATE INDEX IF NOT EXISTS idx_capi_settings_active_channel
  ON capi_settings(user_account_id, account_id, channel)
  WHERE is_active = TRUE;

-- Триггер updated_at
CREATE OR REPLACE FUNCTION update_capi_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_capi_settings_updated_at
BEFORE UPDATE ON capi_settings
FOR EACH ROW EXECUTE FUNCTION update_capi_settings_updated_at();

-- RLS
ALTER TABLE capi_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to capi_settings" ON capi_settings
  FOR ALL USING (true) WITH CHECK (true);

-- Comments
COMMENT ON TABLE capi_settings IS 'CAPI settings per channel per account. Replaces per-direction CAPI fields in account_directions.';
COMMENT ON COLUMN capi_settings.channel IS 'CAPI channel: whatsapp, lead_forms, site';
COMMENT ON COLUMN capi_settings.capi_source IS 'Source of qualification signals: whatsapp (AI analysis) or crm (field/stage mapping)';
COMMENT ON COLUMN capi_settings.ai_l2_description IS 'Free-text description of L2 qualification criteria for AI prompt generation';
COMMENT ON COLUMN capi_settings.ai_l3_description IS 'Free-text description of L3 scheduled criteria for AI prompt generation';
COMMENT ON COLUMN capi_settings.ai_generated_prompt IS 'Auto-generated qualification prompt based on ai_l2/l3_descriptions';
