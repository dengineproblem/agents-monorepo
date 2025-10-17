-- Добавление значения 'agent2' в список допустимых значений для optimization
-- Если в таблице используется ENUM тип, раскомментируйте следующую строку:
-- ALTER TYPE optimization_type ADD VALUE IF NOT EXISTS 'agent2';

-- Если используется CHECK constraint, нужно его пересоздать:
-- Сначала удаляем старый constraint (если есть)
DO $$ 
BEGIN
    -- Удаляем старый CHECK constraint, если он существует
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'user_accounts_optimization_check'
    ) THEN
        ALTER TABLE user_accounts DROP CONSTRAINT user_accounts_optimization_check;
    END IF;
    
    -- Создаем новый CHECK constraint с agent2
    ALTER TABLE user_accounts 
    ADD CONSTRAINT user_accounts_optimization_check 
    CHECK (optimization IS NULL OR optimization IN ('lead_cost', 'qual_lead', 'roi', 'agent2'));
END $$;

-- Комментарий
COMMENT ON COLUMN user_accounts.optimization IS 'Тип оптимизации кампании: lead_cost, qual_lead, roi, agent2';

