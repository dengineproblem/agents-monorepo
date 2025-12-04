-- Change qualification field storage from single field to array of up to 3 fields
-- Lead is qualified if ANY of the selected fields matches

-- Add new JSONB column for storing array of qualification fields
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_qualification_fields JSONB DEFAULT '[]'::jsonb;

-- Migrate existing single field data to array format (if any exists)
UPDATE user_accounts
SET amocrm_qualification_fields = jsonb_build_array(
  jsonb_build_object(
    'field_id', amocrm_qualification_field_id,
    'field_name', amocrm_qualification_field_name,
    'field_type', amocrm_qualification_field_type,
    'enum_id', amocrm_qualification_enum_id,
    'enum_value', amocrm_qualification_enum_value
  )
)
WHERE amocrm_qualification_field_id IS NOT NULL;

-- Drop old columns (commented out for safety - can drop later)
-- ALTER TABLE user_accounts DROP COLUMN IF EXISTS amocrm_qualification_field_id;
-- ALTER TABLE user_accounts DROP COLUMN IF EXISTS amocrm_qualification_field_name;
-- ALTER TABLE user_accounts DROP COLUMN IF EXISTS amocrm_qualification_field_type;
-- ALTER TABLE user_accounts DROP COLUMN IF EXISTS amocrm_qualification_enum_id;
-- ALTER TABLE user_accounts DROP COLUMN IF EXISTS amocrm_qualification_enum_value;

COMMENT ON COLUMN user_accounts.amocrm_qualification_fields IS 'Array of up to 3 qualification field configs. Lead is qualified if ANY field matches. Format: [{field_id, field_name, field_type, enum_id?, enum_value?}]';
