#!/bin/bash

# Скрипт для проверки направлений в базе данных

echo "🔍 Проверяем направления в базе данных..."
echo ""

# Загружаем переменные окружения
if [ -f .env.agent ]; then
    source .env.agent
fi

# Проверяем наличие SUPABASE_URL
if [ -z "$SUPABASE_URL" ]; then
    echo "❌ SUPABASE_URL не найден в .env.agent"
    exit 1
fi

# Извлекаем project ref из URL
PROJECT_REF=$(echo $SUPABASE_URL | sed -n 's/.*https:\/\/\([^.]*\).*/\1/p')

echo "📊 Последние 5 направлений в базе:"
echo ""

# SQL запрос
SQL_QUERY="SELECT 
  ad.id,
  ad.user_account_id,
  ad.name,
  ad.objective,
  ad.is_active,
  to_char(ad.created_at, 'YYYY-MM-DD HH24:MI') as created_at,
  ua.email as user_email
FROM account_directions ad
LEFT JOIN user_accounts ua ON ua.id = ad.user_account_id
ORDER BY ad.created_at DESC
LIMIT 5;"

echo "$SQL_QUERY"
echo ""
echo "Для выполнения запроса используйте Supabase Dashboard или psql"
echo ""
echo "🌐 Supabase Dashboard:"
echo "   https://supabase.com/dashboard/project/$PROJECT_REF/editor"







