#!/bin/bash

# Проверка WhatsApp на Facebook Page для пользователя Testify
# User: 173dfce9-206f-4d4d-bed8-9b7c56674834
# Page: 734116649781310

SUPABASE_URL="https://ikywuvtavpnjlrjtalqi.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreXd1dnRhdnBuamxyanRhbHFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTE0NDc1MywiZXhwIjoyMDYwNzIwNzUzfQ.CAJx7J-CCzbU14EFrZhFcv1qzOLr35dT1-Oh33elOYo"

USER_ID="173dfce9-206f-4d4d-bed8-9b7c56674834"

echo "Получаем access_token и page_id для пользователя Testify..."
echo ""

# Получить access_token
ACCESS_TOKEN=$(curl -s "${SUPABASE_URL}/rest/v1/user_accounts?id=eq.${USER_ID}&select=access_token,page_id" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[0].access_token')

PAGE_ID=$(curl -s "${SUPABASE_URL}/rest/v1/user_accounts?id=eq.${USER_ID}&select=page_id" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[0].page_id')

echo "Page ID: $PAGE_ID"
echo ""

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo "❌ Не удалось получить access_token"
  exit 1
fi

echo "Запрашиваем данные Facebook Page..."
echo ""

# Проверить WhatsApp на странице
curl -s "https://graph.facebook.com/v20.0/${PAGE_ID}?fields=id,name,whatsapp_number&access_token=${ACCESS_TOKEN}" | jq '.'

echo ""
echo "========================================"
echo "Номер из нашей БД: +77006353580"
echo "Проверьте, совпадает ли он с whatsapp_number выше"
echo "========================================"
