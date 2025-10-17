-- Отладочный скрипт для проверки направлений
-- Выполните этот скрипт в Supabase SQL Editor

-- 1. Проверяем структуру таблицы account_directions
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns
WHERE table_name = 'account_directions'
ORDER BY ordinal_position;

-- 2. Проверяем есть ли данные в таблице (без фильтра по пользователю)
SELECT COUNT(*) as total_directions FROM account_directions;

-- 3. Показываем все направления
SELECT 
    id,
    user_account_id,
    name,
    objective,
    daily_budget_cents,
    target_cpl_cents,
    is_active,
    created_at
FROM account_directions
ORDER BY created_at DESC
LIMIT 10;

-- 4. Проверяем RLS политики
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'account_directions';

-- 5. Проверяем, включен ли RLS
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE tablename = 'account_directions';

-- 6. Если вы знаете свой user_id, замените ниже и проверьте направления конкретного пользователя
-- SELECT * FROM account_directions WHERE user_account_id = 'ВАШ-UUID-ЗДЕСЬ';

-- 7. Проверяем связь с user_accounts
SELECT 
    ad.id,
    ad.name,
    ad.user_account_id,
    ua.username,
    ua.email
FROM account_directions ad
LEFT JOIN user_accounts ua ON ad.user_account_id = ua.id
LIMIT 10;

