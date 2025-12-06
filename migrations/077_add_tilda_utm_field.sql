-- Migration 077: Add tilda_utm_field to ad_accounts and user_accounts
-- Позволяет пользователю выбрать, в каком UTM-параметре передаётся Facebook Ad ID
-- Опции: 'utm_source', 'utm_medium', 'utm_campaign' (первые 3 UTM-параметра)
-- По умолчанию: NULL (Tilda не подключена, пока пользователь не выберет поле)

-- =====================================================
-- LEGACY РЕЖИМ: user_accounts
-- (для пользователей с multi_account_enabled = false)
-- =====================================================
ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS tilda_utm_field TEXT DEFAULT NULL;

-- Добавляем constraint отдельно (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_accounts_tilda_utm_field_check'
  ) THEN
    ALTER TABLE user_accounts
    ADD CONSTRAINT user_accounts_tilda_utm_field_check
    CHECK (tilda_utm_field IN ('utm_source', 'utm_medium', 'utm_campaign'));
  END IF;
END $$;

COMMENT ON COLUMN user_accounts.tilda_utm_field IS
  'UTM-параметр, содержащий Facebook Ad ID для лидов с Tilda. NULL = не настроено. Опции: utm_source, utm_medium, utm_campaign';

-- =====================================================
-- MULTI-ACCOUNT РЕЖИМ: ad_accounts
-- (для пользователей с multi_account_enabled = true)
-- =====================================================
ALTER TABLE ad_accounts
ADD COLUMN IF NOT EXISTS tilda_utm_field TEXT DEFAULT NULL;

-- Добавляем constraint отдельно (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ad_accounts_tilda_utm_field_check'
  ) THEN
    ALTER TABLE ad_accounts
    ADD CONSTRAINT ad_accounts_tilda_utm_field_check
    CHECK (tilda_utm_field IN ('utm_source', 'utm_medium', 'utm_campaign'));
  END IF;
END $$;

COMMENT ON COLUMN ad_accounts.tilda_utm_field IS
  'UTM-параметр, содержащий Facebook Ad ID для лидов с Tilda. NULL = не настроено. Опции: utm_source, utm_medium, utm_campaign';
