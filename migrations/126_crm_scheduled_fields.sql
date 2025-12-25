-- Add scheduled fields for CRM-based CAPI integration
-- Similar to qualification fields, but for detecting "scheduled appointment" status

-- AMO CRM: scheduled fields (for detecting Level 3 - Schedule event)
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_scheduled_fields JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN user_accounts.amocrm_scheduled_fields IS 'Array of up to 3 field configs for detecting scheduled appointments. Format: [{field_id, field_name, field_type, enum_id?, enum_value?}]';

-- Bitrix24: scheduled fields
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS bitrix24_scheduled_fields JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN user_accounts.bitrix24_scheduled_fields IS 'Array of up to 3 field configs for detecting scheduled appointments in Bitrix24. Format: [{field_id, field_name, field_type, entity_type, enum_id?, enum_value?}]';

-- Also add to ad_accounts for multi-account mode
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS amocrm_scheduled_fields JSONB DEFAULT '[]'::jsonb;
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS bitrix24_scheduled_fields JSONB DEFAULT '[]'::jsonb;

-- Add is_scheduled field to leads table (similar to is_qualified)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN leads.is_scheduled IS 'Whether lead has scheduled appointment (from CRM sync based on scheduled_fields config)';

CREATE INDEX IF NOT EXISTS idx_leads_is_scheduled
  ON leads(is_scheduled)
  WHERE is_scheduled = TRUE;

-- Add capi_source field to dialog_analysis to track where the qualification came from
-- 'whatsapp' = LLM analysis of WhatsApp dialog
-- 'amocrm' = AMO CRM field mapping
-- 'bitrix24' = Bitrix24 field mapping
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_qualified_source TEXT;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS capi_scheduled_source TEXT;

COMMENT ON COLUMN dialog_analysis.capi_qualified_source IS 'Source of qualification: whatsapp, amocrm, or bitrix24';
COMMENT ON COLUMN dialog_analysis.capi_scheduled_source IS 'Source of scheduled detection: whatsapp, amocrm, or bitrix24';
