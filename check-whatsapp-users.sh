#!/bin/bash

# Supabase credentials
SUPABASE_URL="https://ikywuvtavpnjlrjtalqi.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreXd1dnRhdnBuamxyanRhbHFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTE0NDc1MywiZXhwIjoyMDYwNzIwNzUzfQ.CAJx7J-CCzbU14EFrZhFcv1qzOLr35dT1-Oh33elOYo"

echo "========================================"
echo "1. ОБЩИЕ ДАННЫЕ ПОЛЬЗОВАТЕЛЕЙ"
echo "========================================"

# Проблемные пользователи
for user_id in "a10e54ea-b278-44a4-88bb-a13c50249691" "173dfce9-206f-4d4d-bed8-9b7c56674834" "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"; do
  echo ""
  echo "User ID: $user_id"
  curl -s "${SUPABASE_URL}/rest/v1/user_accounts?id=eq.${user_id}&select=id,user_telegram,page_id,whatsapp_phone_number" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
done

echo ""
echo "========================================"
echo "2. WHATSAPP НАПРАВЛЕНИЯ (DIRECTIONS)"
echo "========================================"

for user_id in "a10e54ea-b278-44a4-88bb-a13c50249691" "173dfce9-206f-4d4d-bed8-9b7c56674834" "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"; do
  echo ""
  echo "User ID: $user_id - WhatsApp Directions:"
  curl -s "${SUPABASE_URL}/rest/v1/account_directions?user_account_id=eq.${user_id}&objective=eq.whatsapp&is_active=eq.true&select=id,name,objective,whatsapp_phone_number_id" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
done

echo ""
echo "========================================"
echo "3. WHATSAPP НОМЕРА В БД"
echo "========================================"

for user_id in "a10e54ea-b278-44a4-88bb-a13c50249691" "173dfce9-206f-4d4d-bed8-9b7c56674834" "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"; do
  echo ""
  echo "User ID: $user_id - WhatsApp Numbers:"
  curl -s "${SUPABASE_URL}/rest/v1/whatsapp_phone_numbers?user_account_id=eq.${user_id}&is_active=eq.true&select=id,phone_number,label,is_default" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
done

echo ""
echo "========================================"
echo "4. ПОСЛЕДНИЕ ОШИБКИ (agent_actions)"
echo "========================================"

for user_id in "a10e54ea-b278-44a4-88bb-a13c50249691" "173dfce9-206f-4d4d-bed8-9b7c56674834"; do
  echo ""
  echo "User ID: $user_id - Recent Errors:"
  curl -s "${SUPABASE_URL}/rest/v1/agent_actions?user_account_id=eq.${user_id}&status=eq.failed&order=created_at.desc&limit=3&select=id,type,created_at,error_json" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
done
