-- Migration: CAPI Messaging dataset upgrade
-- Добавляем capi_access_token, capi_page_id, capi_event_level в account_directions

ALTER TABLE account_directions
  ADD COLUMN IF NOT EXISTS capi_access_token TEXT,
  ADD COLUMN IF NOT EXISTS capi_page_id TEXT,
  ADD COLUMN IF NOT EXISTS capi_event_level INTEGER DEFAULT NULL;

COMMENT ON COLUMN account_directions.capi_access_token IS 'Pixel-specific access token from Events Manager (приоритет над ad_accounts.access_token)';
COMMENT ON COLUMN account_directions.capi_page_id IS 'Facebook Page ID для user_data.page_id в Messaging CAPI';
COMMENT ON COLUMN account_directions.capi_event_level IS 'Уровень триггера события Lead: 1=Интерес, 2=Квалификация, 3=Запись. NULL=все уровни (legacy)';
