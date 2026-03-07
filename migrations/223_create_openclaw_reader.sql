-- =============================================
-- Миграция 223: Read-only пользователь для OpenClaw AI Agent
-- Описание: Создаёт PostgreSQL пользователя openclaw_reader (SELECT only),
--           VIEW без секретных колонок для ad_accounts/user_accounts/ai_bot_configurations,
--           и admin пользователя openclaw_agent в user_accounts
-- Дата: 2026-02-19
-- =============================================

-- ==========================================
-- 1. Read-only пользователь PostgreSQL
-- ==========================================

-- ВАЖНО: замени <STRONG_PASSWORD> на сгенерированный пароль
CREATE USER openclaw_reader WITH PASSWORD '<ПАРОЛЬ_УДАЛЁН_ИЗ_МИГРАЦИИ>';

GRANT CONNECT ON DATABASE postgres TO openclaw_reader;
GRANT USAGE ON SCHEMA public TO openclaw_reader;

-- SELECT на ВСЕ существующие таблицы
GRANT SELECT ON ALL TABLES IN SCHEMA public TO openclaw_reader;

-- SELECT на будущие таблицы автоматически
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO openclaw_reader;

-- SELECT на sequences (нужно для некоторых запросов)
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO openclaw_reader;

-- ==========================================
-- 2. VIEW без секретных колонок: ad_accounts
-- ==========================================
-- Исключены: access_token, tiktok_access_token, openai_api_key, gemini_api_key,
--   amocrm_access_token, amocrm_refresh_token, amocrm_client_secret,
--   fb_page_access_token, bitrix24_access_token, bitrix24_refresh_token,
--   bitrix24_client_secret, anthropic_api_key

CREATE OR REPLACE VIEW openclaw_ad_accounts AS
SELECT
  id, user_account_id, name, username, is_active,
  tarif, tarif_expires, tarif_renewal_cost,
  ad_account_id, page_id, instagram_id, instagram_username,
  business_id, ig_seed_audience_id,
  tiktok_account_id, tiktok_business_id,
  prompt1, prompt2, prompt3, prompt4,
  telegram_id, telegram_id_2, telegram_id_3, telegram_id_4,
  amocrm_subdomain, amocrm_token_expires_at, amocrm_client_id,
  custom_audiences, connection_status, last_error,
  bitrix24_domain, bitrix24_token_expires_at, bitrix24_member_id,
  bitrix24_user_id, bitrix24_qualification_fields, bitrix24_entity_type,
  bitrix24_connected_at, bitrix24_client_id,
  page_picture_url, cached_page_picture_url,
  created_at, updated_at
FROM ad_accounts;

-- ==========================================
-- 3. VIEW без секретных колонок: user_accounts
-- ==========================================
-- Исключены: access_token, tiktok_access_token, openai_api_key, gemini_api_key,
--   anthropic_api_key, amocrm_access_token, amocrm_refresh_token, amocrm_client_secret,
--   fb_page_access_token, bitrix24_access_token, bitrix24_refresh_token,
--   bitrix24_client_secret, bizon_api_token

CREATE OR REPLACE VIEW openclaw_user_accounts AS
SELECT
  id, username, is_active, is_tech_admin, role,
  multi_account_enabled, onboarding_stage, onboarding_tags,
  telegram_id, telegram_id_2, telegram_id_3, telegram_id_4,
  ad_account_id, page_id, instagram_id, instagram_username,
  business_id,
  amocrm_subdomain, amocrm_token_expires_at, amocrm_client_id,
  bitrix24_domain, bitrix24_token_expires_at, bitrix24_member_id,
  bitrix24_user_id, bitrix24_client_id,
  tarif, tarif_expires,
  created_at, updated_at
FROM user_accounts;

-- ==========================================
-- 4. VIEW без секретных колонок: ai_bot_configurations
-- ==========================================
-- Исключены: custom_openai_api_key

CREATE OR REPLACE VIEW openclaw_ai_bot_configurations AS
SELECT
  id, user_account_id, name, is_active,
  system_prompt, temperature, model,
  history_token_limit, history_message_limit, history_time_limit_hours,
  message_buffer_seconds,
  operator_pause_enabled, operator_pause_ignore_first_message,
  operator_auto_resume_hours, operator_auto_resume_minutes,
  operator_pause_exceptions, stop_phrases, resume_phrases,
  split_messages, split_max_length, clean_markdown,
  schedule_enabled, schedule_hours_start, schedule_hours_end,
  schedule_days, timezone, pass_current_datetime,
  voice_recognition_enabled, voice_default_response,
  image_recognition_enabled, image_default_response,
  document_recognition_enabled, document_default_response,
  file_handling_mode, file_default_response,
  start_message, error_message,
  created_at, updated_at
FROM ai_bot_configurations;

-- ==========================================
-- 5. Ограничить доступ к оригиналам, дать к VIEW
-- ==========================================

REVOKE SELECT ON ad_accounts FROM openclaw_reader;
REVOKE SELECT ON user_accounts FROM openclaw_reader;
REVOKE SELECT ON ai_bot_configurations FROM openclaw_reader;

GRANT SELECT ON openclaw_ad_accounts TO openclaw_reader;
GRANT SELECT ON openclaw_user_accounts TO openclaw_reader;
GRANT SELECT ON openclaw_ai_bot_configurations TO openclaw_reader;

-- ==========================================
-- 6. Admin пользователь для API вызовов OpenClaw
-- ==========================================

INSERT INTO user_accounts (
  username, password, is_tech_admin, is_active, role, onboarding_stage
) VALUES (
  'openclaw_agent', 'NOLOGIN_SERVICE_ACCOUNT', true, true, 'admin', 'active'
) RETURNING id;
-- ☝️ ЗАПОМНИ этот UUID — это OPENCLAW_ADMIN_USER_ID для x-user-id заголовка

-- ==========================================
-- Готово
-- ==========================================

DO $$
BEGIN
    RAISE NOTICE 'Миграция 223: openclaw_reader создан (SELECT only), VIEW без секретов созданы, admin user openclaw_agent создан.';
END$$;

NOTIFY pgrst, 'reload schema';
