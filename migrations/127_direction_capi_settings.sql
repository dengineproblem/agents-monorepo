-- Move CAPI settings to direction level
-- Each direction can have its own CAPI configuration

-- Add CAPI settings to account_directions table
ALTER TABLE account_directions ADD COLUMN IF NOT EXISTS capi_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE account_directions ADD COLUMN IF NOT EXISTS capi_source TEXT; -- 'whatsapp' or 'crm'
ALTER TABLE account_directions ADD COLUMN IF NOT EXISTS capi_crm_type TEXT; -- 'amocrm' or 'bitrix24' (if source = 'crm')

-- CRM field mappings for each CAPI level (stored at direction level)
-- Level 1: Interest (Lead event)
ALTER TABLE account_directions ADD COLUMN IF NOT EXISTS capi_interest_fields JSONB DEFAULT '[]'::jsonb;
-- Level 2: Qualified (CompleteRegistration event)
ALTER TABLE account_directions ADD COLUMN IF NOT EXISTS capi_qualified_fields JSONB DEFAULT '[]'::jsonb;
-- Level 3: Scheduled (Schedule event)
ALTER TABLE account_directions ADD COLUMN IF NOT EXISTS capi_scheduled_fields JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN account_directions.capi_enabled IS 'Whether Meta CAPI is enabled for this direction';
COMMENT ON COLUMN account_directions.capi_source IS 'Source of CAPI events: whatsapp (LLM analysis) or crm (field mapping)';
COMMENT ON COLUMN account_directions.capi_crm_type IS 'Which CRM to use for field mapping: amocrm or bitrix24';
COMMENT ON COLUMN account_directions.capi_interest_fields IS 'CRM field configs for Level 1 (Interest/Lead). Format: [{field_id, field_name, field_type, enum_id?, enum_value?}]';
COMMENT ON COLUMN account_directions.capi_qualified_fields IS 'CRM field configs for Level 2 (Qualified/CompleteRegistration). Format: [{field_id, field_name, field_type, enum_id?, enum_value?}]';
COMMENT ON COLUMN account_directions.capi_scheduled_fields IS 'CRM field configs for Level 3 (Scheduled/Schedule). Format: [{field_id, field_name, field_type, enum_id?, enum_value?}]';

-- Index for quick lookup of CAPI-enabled directions
CREATE INDEX IF NOT EXISTS idx_account_directions_capi_enabled
  ON account_directions(capi_enabled)
  WHERE capi_enabled = TRUE;
