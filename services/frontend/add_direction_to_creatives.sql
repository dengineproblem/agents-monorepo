-- Добавление поля direction_id в таблицу user_creatives
-- Связь креативов с направлениями бизнеса

-- Добавляем колонку direction_id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='user_creatives' AND column_name='direction_id') THEN
        ALTER TABLE user_creatives 
        ADD COLUMN direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL;
        
        CREATE INDEX IF NOT EXISTS idx_user_creatives_direction ON user_creatives(direction_id) WHERE direction_id IS NOT NULL;
        
        COMMENT ON COLUMN user_creatives.direction_id IS 'Направление бизнеса, к которому относится этот креатив (опционально)';
        
        RAISE NOTICE 'Колонка direction_id успешно добавлена в user_creatives';
    ELSE
        RAISE NOTICE 'Колонка direction_id уже существует в user_creatives';
    END IF;
END $$;

