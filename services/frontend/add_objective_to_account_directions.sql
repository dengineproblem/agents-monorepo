-- Добавление колонки objective в таблицу account_directions
-- Дата: 2025-10-12
-- Описание: Добавляет тип кампании (objective) для направлений

DO $$ 
BEGIN
    -- Проверяем наличие колонки objective
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='account_directions' AND column_name='objective'
    ) THEN
        -- Добавляем колонку objective
        ALTER TABLE account_directions 
        ADD COLUMN objective TEXT NOT NULL DEFAULT 'whatsapp' 
        CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads'));
        
        -- Добавляем комментарий
        COMMENT ON COLUMN account_directions.objective IS 'Тип кампании: whatsapp (переписки), instagram_traffic (переходы), site_leads (заявки на сайте)';
        
        RAISE NOTICE 'Колонка objective успешно добавлена';
    ELSE
        RAISE NOTICE 'Колонка objective уже существует, пропускаем';
    END IF;
END $$;

-- Создаём индекс для быстрого поиска по objective
CREATE INDEX IF NOT EXISTS idx_account_directions_objective 
ON account_directions(objective, is_active);

-- Проверка: показать структуру таблицы
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns
WHERE table_name = 'account_directions'
ORDER BY ordinal_position;

