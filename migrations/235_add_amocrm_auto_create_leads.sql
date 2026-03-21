-- Тогл авто-создания лидов в AmoCRM при получении из Facebook Lead Forms / Tilda
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_auto_create_leads BOOLEAN DEFAULT FALSE;
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS amocrm_auto_create_leads BOOLEAN DEFAULT FALSE;

-- Дефолтная воронка и этап для новых сделок
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_default_pipeline_id INTEGER;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS amocrm_default_status_id INTEGER;
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS amocrm_default_pipeline_id INTEGER;
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS amocrm_default_status_id INTEGER;
