-- =============================================
-- Миграция 177: Добавление полей для системы продаж консультантов
-- Описание: Добавляет client_name и product_name в таблицу purchases
-- Дата: 2026-02-03
-- =============================================

-- Добавляем поле для имени клиента
ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS client_name VARCHAR(255);

-- Добавляем поле для названия продукта/услуги
ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS product_name VARCHAR(255);

-- Комментарии
COMMENT ON COLUMN purchases.client_name IS 'Имя клиента (для продаж консультантов)';
COMMENT ON COLUMN purchases.product_name IS 'Название продукта или услуги';

-- Обновляем существующие записи с consultant_id (если есть данные в notes, можно использовать как product_name)
-- Это опционально и зависит от вашей бизнес-логики

-- Создаем индекс для поиска по имени клиента
CREATE INDEX IF NOT EXISTS idx_purchases_client_name
ON purchases(client_name)
WHERE client_name IS NOT NULL;

-- Создаем индекс для поиска по продукту
CREATE INDEX IF NOT EXISTS idx_purchases_product_name
ON purchases(product_name)
WHERE product_name IS NOT NULL;

-- =============================================
-- ЗАВЕРШЕНИЕ МИГРАЦИИ 177
-- =============================================

DO $$
DECLARE
    consultant_purchases_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO consultant_purchases_count
    FROM purchases
    WHERE consultant_id IS NOT NULL;

    RAISE NOTICE '============================================';
    RAISE NOTICE 'Миграция 177 успешно применена';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'Добавлено поле: purchases.client_name (VARCHAR 255)';
    RAISE NOTICE 'Добавлено поле: purchases.product_name (VARCHAR 255)';
    RAISE NOTICE 'Создано индексов: 2';
    RAISE NOTICE '';
    RAISE NOTICE 'Статистика:';
    RAISE NOTICE '  - Продаж от консультантов: %', consultant_purchases_count;
    RAISE NOTICE '';
    RAISE NOTICE 'Примечание:';
    RAISE NOTICE '  - Новые поля nullable для обратной совместимости';
    RAISE NOTICE '  - Существующие продажи не изменены';
    RAISE NOTICE '============================================';
END$$;
