#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
API_URL="http://localhost:8082"

# Креатив из направления "Цифровой менеджер" (должен использовать +77074480854)
CREATIVE_CM="4ede49fb-f92b-4c6c-91ae-cb8f06d603af"

echo "================================"
echo "🧪 ТЕСТ: Быстрый тест креатива"
echo "================================"
echo ""
echo "Креатив: $CREATIVE_CM"
echo "Направление: Цифровой менеджер"
echo "Ожидаемый WhatsApp: +77074480854"
echo ""
echo "⏳ Запускаем тест..."
echo ""

# Запускаем быстрый тест
RESPONSE=$(curl -s -X POST "${API_URL}/api/creative-test/start" \
  -H 'Content-Type: application/json' \
  -d "{
    \"user_creative_id\": \"${CREATIVE_CM}\",
    \"user_id\": \"${USER_ID}\",
    \"force\": true
  }")

echo "✅ Ответ получен:"
echo "$RESPONSE" | jq '{success, test_id, adset_id, message}'
echo ""

ADSET_ID=$(echo "$RESPONSE" | jq -r '.adset_id // empty')

if [ -n "$ADSET_ID" ]; then
  echo "================================"
  echo "📋 Проверка результата:"
  echo "================================"
  echo ""
  echo "✅ AdSet создан: $ADSET_ID"
  echo ""
  echo "🔍 В ЛОГАХ agent-service должно быть:"
  echo "   'Using WhatsApp number from direction for test'"
  echo "   creativeId: $CREATIVE_CM"
  echo "   directionId: 6c7423d0-9ec6-45e3-a108-7924c57effea"
  echo "   phone_number: +77074480854"
  echo "   source: direction"
  echo ""
  echo "📱 В Facebook Ads Manager AdSet должен иметь:"
  echo "   WhatsApp номер: +77074480854"
  echo ""
else
  echo "❌ Не удалось создать AdSet"
  echo "$RESPONSE" | jq '.'
fi
