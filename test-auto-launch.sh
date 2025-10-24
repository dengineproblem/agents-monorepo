#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
API_URL="http://localhost:8082"

echo "================================"
echo "🧪 ТЕСТ: Автозапуск (auto-launch-v2)"
echo "================================"
echo ""
echo "Направления:"
echo "  1. Цифровой менеджер → Ожидаемый номер: +77074480854"
echo "  2. AI-таргетолог → Ожидаемый номер: +77074094375"
echo ""
echo "Запускаем автозапуск для всех активных направлений..."
echo ""

LAUNCH_RESPONSE=$(curl -s -X POST "${API_URL}/api/campaign-builder/auto-launch-v2" \
  -H 'Content-Type: application/json' \
  -d "{
    \"user_account_id\": \"${USER_ID}\",
    \"start_mode\": \"now\"
  }")

echo "Ответ API:"
echo "$LAUNCH_RESPONSE" | jq '.'
echo ""

# Проверяем результаты для каждого направления
echo "================================"
echo "📊 Результаты по направлениям:"
echo "================================"
echo ""

CM_RESULT=$(echo "$LAUNCH_RESPONSE" | jq -r '.results[] | select(.direction_name == "Цифровой менеджер")')
AI_RESULT=$(echo "$LAUNCH_RESPONSE" | jq -r '.results[] | select(.direction_name == "AI-таргетолог")')

if [ -n "$CM_RESULT" ]; then
  echo "1️⃣ Цифровой менеджер:"
  echo "$CM_RESULT" | jq '{direction_name, campaign_id, adset_id, ads_count, message}'
  echo ""
else
  echo "❌ Цифровой менеджер: нет результата"
  echo ""
fi

if [ -n "$AI_RESULT" ]; then
  echo "2️⃣ AI-таргетолог:"
  echo "$AI_RESULT" | jq '{direction_name, campaign_id, adset_id, ads_count, message}'
  echo ""
else
  echo "❌ AI-таргетолог: нет результата"
  echo ""
fi

echo "================================"
echo "✅ Проверка:"
echo "================================"
echo ""
echo "📋 Смотрите логи agent-service (в терминале):"
echo "   Должно быть ДВА сообщения:"
echo "   1. 'Using WhatsApp number from direction' с номером +77074480854"
echo "   2. 'Using WhatsApp number from direction' с номером +77074094375"
echo ""
echo "📱 Проверьте в Facebook Ads Manager:"
echo "   У каждого направления должны быть РАЗНЫЕ WhatsApp номера!"
echo ""
