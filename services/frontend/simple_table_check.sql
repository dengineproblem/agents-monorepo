-- Простая проверка колонок в таблицах

-- Проверка колонок user_directions
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'user_directions' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Проверка колонок planned_metrics
SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
FROM information_schema.columns 
WHERE table_name = 'planned_metrics' 
AND table_schema = 'public'
ORDER BY ordinal_position;