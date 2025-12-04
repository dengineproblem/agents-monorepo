-- Add qualification field ID for AmoCRM custom field selection
-- This field stores the ID of the custom field in AmoCRM that determines lead qualification

ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_qualification_field_id INTEGER;

-- Also store the field name for display purposes
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_qualification_field_name TEXT;

COMMENT ON COLUMN user_accounts.amocrm_qualification_field_id IS 'ID of the custom field in AmoCRM used to determine lead qualification (checkbox/boolean field)';
COMMENT ON COLUMN user_accounts.amocrm_qualification_field_name IS 'Name of the custom field for display in UI';
