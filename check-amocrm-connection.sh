#!/bin/bash

# Проверка подключения AmoCRM для пользователя

echo "🔍 Проверка подключения AmoCRM"
echo "================================"
echo ""

# Получить user_id из аргумента или спросить
if [ -z "$1" ]; then
  echo "Введите user_id (UUID пользователя):"
  read USER_ID
else
  USER_ID=$1
fi

echo "Проверяем пользователя: $USER_ID"
echo ""

# Проверить в БД
docker-compose exec -T postgres psql -U postgres -d postgres << EOF
SELECT 
  id,
  username,
  CASE 
    WHEN amocrm_subdomain IS NOT NULL THEN '✅ ' || amocrm_subdomain
    ELSE '❌ Не подключено'
  END as subdomain,
  CASE 
    WHEN amocrm_access_token IS NOT NULL THEN '✅ Есть'
    ELSE '❌ Нет'
  END as access_token,
  CASE 
    WHEN amocrm_refresh_token IS NOT NULL THEN '✅ Есть'
    ELSE '❌ Нет'
  END as refresh_token,
  amocrm_token_expires_at as token_expires
FROM user_accounts
WHERE id = '$USER_ID';
EOF

echo ""
echo "================================"
echo ""
echo "📊 Проверка через API:"
echo ""
echo "curl 'http://localhost:8082/amocrm/status?userAccountId=$USER_ID'"
echo ""

# Проверить через API
RESPONSE=$(curl -s "http://localhost:8082/amocrm/status?userAccountId=$USER_ID")
echo "$RESPONSE" | jq '.'

echo ""
echo "================================"






