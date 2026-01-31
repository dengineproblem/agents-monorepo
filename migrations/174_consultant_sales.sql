-- =============================================
-- Миграция 174: Система продаж для консультантов
-- Описание: Добавляет возможность консультантам отслеживать продажи и прогресс к месячному плану
-- Дата: 2026-01-31
-- =============================================

-- 1. ДОБАВЛЕНИЕ ПОЛЯ CONSULTANT_ID В PURCHASES
-- =============================================

-- Добавляем поле для связи продажи с консультантом
ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS consultant_id UUID REFERENCES consultants(id) ON DELETE SET NULL;

-- Комментарий
COMMENT ON COLUMN purchases.consultant_id IS 'Консультант, который добавил продажу (NULL для продаж из рекламы/AmoCRM)';

-- Индекс для быстрой фильтрации продаж консультанта
CREATE INDEX IF NOT EXISTS idx_purchases_consultant
ON purchases(consultant_id)
WHERE consultant_id IS NOT NULL;

-- Индекс для поиска по дате и консультанту (для статистики)
CREATE INDEX IF NOT EXISTS idx_purchases_consultant_date
ON purchases(consultant_id, purchase_date)
WHERE consultant_id IS NOT NULL;

-- 2. СОЗДАНИЕ ТАБЛИЦЫ ПЛАНОВ ПРОДАЖ
-- =============================================

CREATE TABLE IF NOT EXISTS sales_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
    period_year INTEGER NOT NULL CHECK (period_year >= 2020 AND period_year <= 2100),
    period_month INTEGER NOT NULL CHECK (period_month >= 1 AND period_month <= 12),
    plan_amount NUMERIC(12, 2) NOT NULL CHECK (plan_amount >= 0),
    currency VARCHAR(3) DEFAULT 'KZT' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Уникальный план на месяц для каждого консультанта
    UNIQUE(consultant_id, period_year, period_month)
);

-- Индексы для sales_plans
CREATE INDEX IF NOT EXISTS idx_sales_plans_consultant
ON sales_plans(consultant_id);

CREATE INDEX IF NOT EXISTS idx_sales_plans_period
ON sales_plans(period_year, period_month);

CREATE INDEX IF NOT EXISTS idx_sales_plans_consultant_period
ON sales_plans(consultant_id, period_year, period_month);

-- Комментарий
COMMENT ON TABLE sales_plans IS 'Месячные планы продаж для консультантов';
COMMENT ON COLUMN sales_plans.consultant_id IS 'ID консультанта';
COMMENT ON COLUMN sales_plans.period_year IS 'Год планирования (2020-2100)';
COMMENT ON COLUMN sales_plans.period_month IS 'Месяц планирования (1-12)';
COMMENT ON COLUMN sales_plans.plan_amount IS 'Плановая сумма продаж в указанной валюте';
COMMENT ON COLUMN sales_plans.currency IS 'Валюта плана (по умолчанию KZT)';

-- 3. ТРИГГЕР ДЛЯ ОБНОВЛЕНИЯ UPDATED_AT
-- =============================================

CREATE OR REPLACE FUNCTION update_sales_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sales_plans_updated_at ON sales_plans;
CREATE TRIGGER trigger_sales_plans_updated_at
    BEFORE UPDATE ON sales_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_sales_plans_updated_at();

-- 4. RLS (ROW LEVEL SECURITY)
-- =============================================

ALTER TABLE sales_plans ENABLE ROW LEVEL SECURITY;

-- Политики для sales_plans
DROP POLICY IF EXISTS sales_plans_select ON sales_plans;
CREATE POLICY sales_plans_select ON sales_plans
    FOR SELECT USING (true);

DROP POLICY IF EXISTS sales_plans_insert ON sales_plans;
CREATE POLICY sales_plans_insert ON sales_plans
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS sales_plans_update ON sales_plans;
CREATE POLICY sales_plans_update ON sales_plans
    FOR UPDATE USING (true);

DROP POLICY IF EXISTS sales_plans_delete ON sales_plans;
CREATE POLICY sales_plans_delete ON sales_plans
    FOR DELETE USING (true);

-- 5. ПРЕДСТАВЛЕНИЕ ДЛЯ СТАТИСТИКИ ПРОДАЖ КОНСУЛЬТАНТА
-- =============================================

CREATE OR REPLACE VIEW consultant_sales_stats AS
SELECT
    c.id as consultant_id,
    c.user_account_id,
    c.name as consultant_name,

    -- Статистика за всё время
    COUNT(DISTINCT p.id) as total_sales_count,
    COALESCE(SUM(p.amount), 0) as total_sales_amount,

    -- Статистика за текущий месяц
    COUNT(DISTINCT p.id) FILTER (
        WHERE EXTRACT(YEAR FROM p.purchase_date) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND EXTRACT(MONTH FROM p.purchase_date) = EXTRACT(MONTH FROM CURRENT_DATE)
    ) as current_month_sales_count,
    COALESCE(SUM(p.amount) FILTER (
        WHERE EXTRACT(YEAR FROM p.purchase_date) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND EXTRACT(MONTH FROM p.purchase_date) = EXTRACT(MONTH FROM CURRENT_DATE)
    ), 0) as current_month_sales_amount,

    -- План на текущий месяц
    sp.plan_amount as current_month_plan,

    -- Прогресс к плану (процент)
    CASE
        WHEN sp.plan_amount IS NOT NULL AND sp.plan_amount > 0
        THEN ROUND(
            100.0 * COALESCE(SUM(p.amount) FILTER (
                WHERE EXTRACT(YEAR FROM p.purchase_date) = EXTRACT(YEAR FROM CURRENT_DATE)
                  AND EXTRACT(MONTH FROM p.purchase_date) = EXTRACT(MONTH FROM CURRENT_DATE)
            ), 0) / sp.plan_amount,
            1
        )
        ELSE NULL
    END as plan_progress_percent

FROM consultants c
LEFT JOIN purchases p ON p.consultant_id = c.id
LEFT JOIN sales_plans sp ON sp.consultant_id = c.id
    AND sp.period_year = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
    AND sp.period_month = EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER
WHERE c.is_active = true
GROUP BY c.id, c.user_account_id, c.name, sp.plan_amount;

COMMENT ON VIEW consultant_sales_stats IS 'Статистика продаж консультантов с прогрессом к месячному плану';

-- Права на view
GRANT SELECT ON consultant_sales_stats TO authenticated;

-- =============================================
-- ЗАВЕРШЕНИЕ МИГРАЦИИ 174
-- =============================================

DO $$
DECLARE
    total_purchases INTEGER;
    consultant_purchases INTEGER;
    total_consultants INTEGER;
BEGIN
    -- Считаем статистику
    SELECT COUNT(*) INTO total_purchases FROM purchases;
    SELECT COUNT(*) INTO consultant_purchases FROM purchases WHERE consultant_id IS NOT NULL;
    SELECT COUNT(*) INTO total_consultants FROM consultants WHERE is_active = true;

    RAISE NOTICE '============================================';
    RAISE NOTICE 'Миграция 174 успешно применена';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'Добавлено поле: purchases.consultant_id (nullable)';
    RAISE NOTICE 'Создана таблица: sales_plans';
    RAISE NOTICE 'Создано представление: consultant_sales_stats';
    RAISE NOTICE 'Создано индексов: 4';
    RAISE NOTICE '';
    RAISE NOTICE 'Статистика:';
    RAISE NOTICE '  - Всего продаж в базе: %', total_purchases;
    RAISE NOTICE '  - Продаж от консультантов: %', consultant_purchases;
    RAISE NOTICE '  - Активных консультантов: %', total_consultants;
    RAISE NOTICE '';
    RAISE NOTICE 'Обратная совместимость:';
    RAISE NOTICE '  - consultant_id nullable - старые продажи работают';
    RAISE NOTICE '  - Продажи из рекламы/AmoCRM: consultant_id = NULL';
    RAISE NOTICE '  - ROI аналитика продолжает работать';
    RAISE NOTICE '============================================';
END$$;
