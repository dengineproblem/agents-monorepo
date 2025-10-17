-- Проверка структуры таблиц планов в Supabase

-- 1. Проверка существования таблиц
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('user_directions', 'planned_metrics')
ORDER BY table_name;

-- 2. Детальная структура таблицы user_directions
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'user_directions'
ORDER BY ordinal_position;

-- 3. Детальная структура таблицы planned_metrics  
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length,
    numeric_precision,
    numeric_scale
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'planned_metrics'
ORDER BY ordinal_position;

-- 4. Проверка ограничений (constraints)
SELECT 
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
LEFT JOIN information_schema.constraint_column_usage ccu 
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public' 
AND tc.table_name IN ('user_directions', 'planned_metrics')
ORDER BY tc.table_name, tc.constraint_name;

-- 5. Проверка индексов
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
AND tablename IN ('user_directions', 'planned_metrics')
ORDER BY tablename, indexname;