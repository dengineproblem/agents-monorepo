-- =============================================
-- Migration 190: CRM subscription billing system
-- Description:
--   - Product catalog for subscriptions (1/3/12 months)
--   - Separate CRM sales table for subscription/custom sales (without purchases coupling)
--   - Phone -> user link table for tech-admin manual matching
-- Date: 2026-02-04
-- =============================================

-- =====================================================
-- 1) Product catalog
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_subscription_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  months INTEGER NOT NULL CHECK (months > 0),
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'KZT',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE crm_subscription_products IS 'Каталог подписочных SKU для CRM';
COMMENT ON COLUMN crm_subscription_products.sku IS 'Стабильный SKU (SUB_1M/SUB_3M/SUB_12M)';
COMMENT ON COLUMN crm_subscription_products.active IS 'Видимость SKU в CRM для новых продаж';

CREATE INDEX IF NOT EXISTS idx_crm_subscription_products_active
  ON crm_subscription_products(active)
  WHERE active = true;

-- =====================================================
-- 2) Sales table (separate from purchases)
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_subscription_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  consultant_id UUID REFERENCES consultants(id) ON DELETE SET NULL,

  -- Lead identity from CRM side
  client_name TEXT,
  client_phone TEXT NOT NULL,
  normalized_phone TEXT NOT NULL,

  -- Product/custom payload
  product_id UUID REFERENCES crm_subscription_products(id) ON DELETE SET NULL,
  custom_product_name TEXT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  months INTEGER CHECK (months IS NULL OR months > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'KZT',

  -- Kind and lifecycle
  sale_kind TEXT NOT NULL CHECK (sale_kind IN ('subscription', 'custom')),
  status TEXT NOT NULL DEFAULT 'pending_link'
    CHECK (status IN ('pending_link', 'linked', 'applied', 'cancelled')),

  -- Manual mapping to user_accounts (tech admin)
  user_account_id UUID REFERENCES user_accounts(id) ON DELETE SET NULL,
  linked_by UUID REFERENCES user_accounts(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ,

  -- Apply markers
  applied_by UUID REFERENCES user_accounts(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,

  -- Dates and notes
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  comment TEXT,
  source TEXT NOT NULL DEFAULT 'crm',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE crm_subscription_sales IS 'Продажи подписок/кастомных товаров в CRM, отдельно от purchases';
COMMENT ON COLUMN crm_subscription_sales.sale_kind IS 'subscription = влияет на доступ, custom = просто продажа';
COMMENT ON COLUMN crm_subscription_sales.status IS 'pending_link -> linked -> applied';
COMMENT ON COLUMN crm_subscription_sales.user_account_id IS 'Ручная привязка tech admin к user_accounts';

CREATE INDEX IF NOT EXISTS idx_crm_subscription_sales_status
  ON crm_subscription_sales(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_subscription_sales_consultant
  ON crm_subscription_sales(consultant_id, sale_date DESC)
  WHERE consultant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_subscription_sales_phone
  ON crm_subscription_sales(normalized_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_subscription_sales_user
  ON crm_subscription_sales(user_account_id, created_at DESC)
  WHERE user_account_id IS NOT NULL;

-- =====================================================
-- 3) Phone-to-user manual links
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_phone_user_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_phone TEXT NOT NULL,
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  linked_by UUID REFERENCES user_accounts(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_crm_phone_user_links UNIQUE (normalized_phone, user_account_id)
);

COMMENT ON TABLE crm_phone_user_links IS 'Ручные соответствия phone -> user_account_id. Один phone может соответствовать нескольким user.';
COMMENT ON COLUMN crm_phone_user_links.active IS 'Можно мягко деактивировать связь без удаления';

CREATE INDEX IF NOT EXISTS idx_crm_phone_user_links_phone
  ON crm_phone_user_links(normalized_phone, active)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_crm_phone_user_links_user
  ON crm_phone_user_links(user_account_id, active)
  WHERE active = true;

-- =====================================================
-- 4) updated_at triggers
-- =====================================================

CREATE OR REPLACE FUNCTION crm_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_subscription_products_updated_at ON crm_subscription_products;
CREATE TRIGGER trg_crm_subscription_products_updated_at
  BEFORE UPDATE ON crm_subscription_products
  FOR EACH ROW
  EXECUTE FUNCTION crm_set_updated_at();

DROP TRIGGER IF EXISTS trg_crm_subscription_sales_updated_at ON crm_subscription_sales;
CREATE TRIGGER trg_crm_subscription_sales_updated_at
  BEFORE UPDATE ON crm_subscription_sales
  FOR EACH ROW
  EXECUTE FUNCTION crm_set_updated_at();

DROP TRIGGER IF EXISTS trg_crm_phone_user_links_updated_at ON crm_phone_user_links;
CREATE TRIGGER trg_crm_phone_user_links_updated_at
  BEFORE UPDATE ON crm_phone_user_links
  FOR EACH ROW
  EXECUTE FUNCTION crm_set_updated_at();

-- =====================================================
-- 5) Seed default SKU catalog
-- =====================================================

INSERT INTO crm_subscription_products (sku, name, months, price, currency, active)
VALUES
  ('SUB_1M', 'Подписка 1 месяц', 1, 49000, 'KZT', true),
  ('SUB_3M', 'Подписка 3 месяца', 3, 99000, 'KZT', true),
  ('SUB_12M', 'Подписка 12 месяцев', 12, 299000, 'KZT', true)
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name,
  months = EXCLUDED.months,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  active = EXCLUDED.active,
  updated_at = NOW();

-- =====================================================
-- 6) Extend user_accounts.tarif constraint for subscription modes
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_accounts_tarif_check'
  ) THEN
    ALTER TABLE user_accounts
      DROP CONSTRAINT user_accounts_tarif_check;
  END IF;

  ALTER TABLE user_accounts
    ADD CONSTRAINT user_accounts_tarif_check
    CHECK (
      (tarif)::text = ANY (
        ARRAY[
          'ai_target'::character varying,
          'target'::character varying,
          'ai_manager'::character varying,
          'complex'::character varying,
          'subscription_1m'::character varying,
          'subscription_3m'::character varying,
          'subscription_12m'::character varying
        ]::text[]
      )
    );
END$$;

-- =====================================================
-- 7) RLS (service_role full access)
-- =====================================================

ALTER TABLE crm_subscription_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_subscription_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_phone_user_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to crm_subscription_products" ON crm_subscription_products;
CREATE POLICY "Service role full access to crm_subscription_products"
ON crm_subscription_products
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to crm_subscription_sales" ON crm_subscription_sales;
CREATE POLICY "Service role full access to crm_subscription_sales"
ON crm_subscription_sales
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to crm_phone_user_links" ON crm_phone_user_links;
CREATE POLICY "Service role full access to crm_phone_user_links"
ON crm_phone_user_links
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- 8) Verification notice
-- =====================================================

DO $$
DECLARE
  products_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO products_count FROM crm_subscription_products;

  RAISE NOTICE '============================================';
  RAISE NOTICE 'Migration 190 applied';
  RAISE NOTICE 'crm_subscription_products: seeded SKU count = %', products_count;
  RAISE NOTICE 'crm_subscription_sales: created';
  RAISE NOTICE 'crm_phone_user_links: created';
  RAISE NOTICE '============================================';
END$$;
