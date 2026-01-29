-- Add Bitrix24 field mapping configuration
-- Stores mapping from Facebook Lead Form fields to Bitrix24 fields

-- For multi-account mode (ad_accounts table)
ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_field_mapping JSONB DEFAULT '[]';

-- For legacy mode (user_accounts table)
ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_field_mapping JSONB DEFAULT '[]';

-- Example mapping format:
-- [
--   {
--     "leadFormField": "full_name",
--     "bitrixField": "NAME",
--     "bitrixFieldType": "standard"
--   },
--   {
--     "leadFormField": "phone_number",
--     "bitrixField": "PHONE",
--     "bitrixFieldType": "standard"
--   },
--   {
--     "leadFormField": "custom_question_1",
--     "bitrixField": "UF_CRM_123456",
--     "bitrixFieldType": "custom"
--   }
-- ]

COMMENT ON COLUMN ad_accounts.bitrix24_field_mapping IS 'JSON array of field mappings from Facebook Lead Form to Bitrix24 fields';
COMMENT ON COLUMN user_accounts.bitrix24_field_mapping IS 'JSON array of field mappings from Facebook Lead Form to Bitrix24 fields (legacy mode)';
