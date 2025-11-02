#!/bin/bash

SUPABASE_URL="https://ikywuvtavpnjlrjtalqi.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreXd1dnRhdnBuamxyanRhbHFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTE0NDc1MywiZXhwIjoyMDYwNzIwNzUzfQ.CAJx7J-CCzbU14EFrZhFcv1qzOLr35dT1-Oh33elOYo"

echo "ДЕТАЛЬНАЯ ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЯХ"
echo "========================================"

for user_id in "a10e54ea-b278-44a4-88bb-a13c50249691" "173dfce9-206f-4d4d-bed8-9b7c56674834" "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"; do
  echo ""
  case $user_id in
    "a10e54ea-b278-44a4-88bb-a13c50249691") echo "❌ ПРОБЛЕМНЫЙ ПОЛЬЗОВАТЕЛЬ #1" ;;
    "173dfce9-206f-4d4d-bed8-9b7c56674834") echo "❌ ПРОБЛЕМНЫЙ ПОЛЬЗОВАТЕЛЬ #2" ;;
    "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b") echo "✅ РАБОТАЮЩИЙ ПОЛЬЗОВАТЕЛЬ" ;;
  esac

  echo "User ID: $user_id"
  echo "---"

  curl -s "${SUPABASE_URL}/rest/v1/user_accounts?id=eq.${user_id}&select=id,page_id,whatsapp_phone_number,instagram_id" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
done
