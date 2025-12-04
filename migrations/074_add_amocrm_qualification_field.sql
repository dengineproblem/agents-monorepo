-- Add qualification field settings for AmoCRM custom field selection
-- Supports checkbox, select, and multiselect field types

ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_qualification_field_id INTEGER;

-- Store the field name for display purposes
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_qualification_field_name TEXT;

-- Store field type (checkbox, select, multiselect)
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_qualification_field_type TEXT;

-- For select/multiselect fields: store the enum ID that means "qualified"
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_qualification_enum_id INTEGER;

-- For select/multiselect fields: store the enum value name for display
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_qualification_enum_value TEXT;

COMMENT ON COLUMN user_accounts.amocrm_qualification_field_id IS 'ID of the custom field in AmoCRM used to determine lead qualification';
COMMENT ON COLUMN user_accounts.amocrm_qualification_field_name IS 'Name of the custom field for display in UI';
COMMENT ON COLUMN user_accounts.amocrm_qualification_field_type IS 'Type of field: checkbox, select, or multiselect';
COMMENT ON COLUMN user_accounts.amocrm_qualification_enum_id IS 'For select/multiselect: ID of the enum value that means qualified';
COMMENT ON COLUMN user_accounts.amocrm_qualification_enum_value IS 'For select/multiselect: name of the enum value for display';
