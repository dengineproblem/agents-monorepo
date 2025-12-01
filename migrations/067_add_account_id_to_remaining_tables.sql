-- Migration 067: Add account_id to remaining tables for full multi-account support
-- Created: 2025-12-01
-- Description: Adds account_id (UUID FK to ad_accounts.id) to tables that don't have it yet
--
-- Tables affected:
--   - leads (ROI analytics)
--   - purchases (ROI analytics)
--   - sales (ROI analytics - альтернативная таблица)
--   - user_competitors (competitors per ad_account)
--   - whatsapp_instances (WhatsApp per ad_account)
--   - creative_metrics_history (metrics per ad_account)
--
-- IMPORTANT: All changes are backward compatible (NULL allowed for legacy mode)

-- =====================================================
-- 1. LEADS - для ROI аналитики
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE leads ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;
    COMMENT ON COLUMN leads.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_account_id ON leads(account_id) WHERE account_id IS NOT NULL;

-- =====================================================
-- 2. PURCHASES - для ROI аналитики (продажи из AmoCRM)
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchases' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE purchases ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;
    COMMENT ON COLUMN purchases.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchases_account_id ON purchases(account_id) WHERE account_id IS NOT NULL;

-- =====================================================
-- 3. USER_COMPETITORS - разделение конкурентов по аккаунтам
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_competitors' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE user_competitors ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;
    COMMENT ON COLUMN user_competitors.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_competitors_account_id ON user_competitors(account_id) WHERE account_id IS NOT NULL;

-- =====================================================
-- 4. WHATSAPP_INSTANCES - привязка WhatsApp к аккаунту
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_instances' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE whatsapp_instances ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;
    COMMENT ON COLUMN whatsapp_instances.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_account_id ON whatsapp_instances(account_id) WHERE account_id IS NOT NULL;

-- =====================================================
-- 5. CREATIVE_METRICS_HISTORY - метрики по аккаунтам
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creative_metrics_history' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE creative_metrics_history ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;
    COMMENT ON COLUMN creative_metrics_history.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_creative_metrics_history_account_id ON creative_metrics_history(account_id) WHERE account_id IS NOT NULL;

-- =====================================================
-- 6. SALES - для ROI аналитики (альтернативная таблица продаж)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'sales'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE sales ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;
    COMMENT ON COLUMN sales.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
    CREATE INDEX IF NOT EXISTS idx_sales_account_id ON sales(account_id) WHERE account_id IS NOT NULL;
  END IF;
END $$;

-- =====================================================
-- 7. CREATIVE_ANALYSIS - добавляем если нет (для analyzerService)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'creative_analysis'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creative_analysis' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE creative_analysis ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;
    COMMENT ON COLUMN creative_analysis.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
    CREATE INDEX IF NOT EXISTS idx_creative_analysis_account_id ON creative_analysis(account_id) WHERE account_id IS NOT NULL;
  END IF;
END $$;

-- =====================================================
-- VERIFICATION: Check all account_id columns exist
-- =====================================================
DO $$
DECLARE
  missing_tables TEXT := '';
BEGIN
  -- Check leads
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'account_id') THEN
    missing_tables := missing_tables || 'leads, ';
  END IF;

  -- Check purchases
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchases' AND column_name = 'account_id') THEN
    missing_tables := missing_tables || 'purchases, ';
  END IF;

  -- Check user_competitors
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_competitors' AND column_name = 'account_id') THEN
    missing_tables := missing_tables || 'user_competitors, ';
  END IF;

  -- Check whatsapp_instances
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_instances' AND column_name = 'account_id') THEN
    missing_tables := missing_tables || 'whatsapp_instances, ';
  END IF;

  -- Check creative_metrics_history
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creative_metrics_history' AND column_name = 'account_id') THEN
    missing_tables := missing_tables || 'creative_metrics_history, ';
  END IF;

  IF missing_tables != '' THEN
    RAISE WARNING 'Migration 067: account_id column missing in tables: %', RTRIM(missing_tables, ', ');
  ELSE
    RAISE NOTICE 'Migration 067: All account_id columns created successfully';
  END IF;
END $$;
