-- =============================================
-- Миграция 175: Исправление ссылок на несуществующее поле purchase_date
-- Описание: В миграции 174 был создан индекс и view с purchase_date, но это поле не существует. Используем created_at.
-- Дата: 2026-01-31
-- =============================================

-- 1. ПЕРЕСОЗДАНИЕ ИНДЕКСА С ПРАВИЛЬНЫМ ПОЛЕМ
-- =============================================

-- Удаляем неправильный индекс (если создался)
DROP INDEX IF EXISTS idx_purchases_consultant_date;

-- Создаём правильный индекс с created_at
CREATE INDEX IF NOT EXISTS idx_purchases_consultant_date
ON purchases(consultant_id, created_at)
WHERE consultant_id IS NOT NULL;

-- 2. ПЕРЕСОЗДАНИЕ VIEW С ПРАВИЛЬНЫМ ПОЛЕМ
-- =============================================

-- Удаляем старый view
DROP VIEW IF EXISTS consultant_sales_stats;

-- Создаём правильный view с created_at вместо purchase_date
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
        WHERE EXTRACT(YEAR FROM p.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND EXTRACT(MONTH FROM p.created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
    ) as current_month_sales_count,
    COALESCE(SUM(p.amount) FILTER (
        WHERE EXTRACT(YEAR FROM p.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND EXTRACT(MONTH FROM p.created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
    ), 0) as current_month_sales_amount,

    -- План на текущий месяц
    sp.plan_amount as current_month_plan,

    -- Прогресс к плану (процент)
    CASE
        WHEN sp.plan_amount IS NOT NULL AND sp.plan_amount > 0
        THEN ROUND(
            100.0 * COALESCE(SUM(p.amount) FILTER (
                WHERE EXTRACT(YEAR FROM p.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
                  AND EXTRACT(MONTH FROM p.created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
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

COMMENT ON VIEW consultant_sales_stats IS 'Статистика продаж консультантов с прогрессом к месячному плану (использует created_at как дату продажи)';

-- Права на view
GRANT SELECT ON consultant_sales_stats TO authenticated;

-- =============================================
-- ЗАВЕРШЕНИЕ МИГРАЦИИ 175
-- =============================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE 'Миграция 175 успешно применена';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'Исправлен индекс: idx_purchases_consultant_date (использует created_at)';
    RAISE NOTICE 'Пересоздан view: consultant_sales_stats (использует created_at)';
    RAISE NOTICE '';
    RAISE NOTICE 'Важно: purchases.purchase_date не существует, используется created_at';
    RAISE NOTICE '============================================';
END$$;
