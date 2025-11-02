#!/bin/bash

# Проверка связи Page -> WhatsApp Business Account через Facebook API

SUPABASE_URL="https://ikywuvtavpnjlrjtalqi.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreXd1dnRhdnBuamxyanRhbHFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTE0NDc1MywiZXhwIjoyMDYwNzIwNzUzfQ.CAJx7J-CCzbU14EFrZhFcv1qzOLr35dT1-Oh33elOYo"

USER_ID="173dfce9-206f-4d4d-bed8-9b7c56674834"
PAGE_ID="734116649781310"
WABA_ID="792684993372941"

echo "========================================"
echo "Проверка WhatsApp Business настроек"
echo "========================================"
echo ""

# Получить access_token
ACCESS_TOKEN=$(curl -s "${SUPABASE_URL}/rest/v1/user_accounts?id=eq.${USER_ID}&select=access_token" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[0].access_token')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo "❌ Не удалось получить access_token"
  exit 1
fi

echo "1. Информация о Page:"
echo "---"
curl -s "https://graph.facebook.com/v20.0/${PAGE_ID}?fields=id,name&access_token=${ACCESS_TOKEN}" | jq '.'
echo ""

echo "2. WhatsApp Business Account (WABA) информация:"
echo "---"
curl -s "https://graph.facebook.com/v20.0/${WABA_ID}?fields=id,name,account_review_status,business_verification_status,messaging_api_rate_limit&access_token=${ACCESS_TOKEN}" | jq '.'
echo ""

echo "3. Номера телефонов в WABA:"
echo "---"
curl -s "https://graph.facebook.com/v20.0/${WABA_ID}/phone_numbers?access_token=${ACCESS_TOKEN}" | jq '.'
echo ""

echo "4. Проверка связи Page <-> WABA через subscribed_apps:"
echo "---"
curl -s "https://graph.facebook.com/v20.0/${PAGE_ID}/subscribed_apps?access_token=${ACCESS_TOKEN}" | jq '.'
echo ""

echo "========================================"
echo "ВАЖНО: Проверьте, есть ли номер +77006353580"
echo "в списке phone_numbers выше"
echo "========================================"
