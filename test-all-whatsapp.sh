#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
API_URL="http://localhost:8082"

# ID направлений
DIR_CM="6c7423d0-9ec6-45e3-a108-7924c57effea"  # Цифровой менеджер (+77074480854)
DIR_AI="7a25d7a2-e0a1-4acb-987b-9ecd4e9a7ba9"  # AI-таргетолог (+77074094375)

# Известный креатив из логов
CREATIVE_CM="4ede49fb-f92b-4c6c-91ae-cb8f06d603af"

echo "================================"
echo "🧪 ТЕСТ 1: Быстрый тест креатива"
echo "================================"
echo ""
echo "Креатив: $CREATIVE_CM (из направления 'Цифровой менеджер')"
echo "Ожидаемый номер: +77074480854"
echo ""
echo "Запускаем тест..."

TEST_RESPONSE=$(curl -s -X POST "${API_URL}/api/creative-test/start" \
  -H 'Content-Type: application/json' \
  -d "{
    \"user_creative_id\": \"${CREATIVE_CM}\",
    \"user_id\": \"${USER_ID}\",
    \"force\": true
  }")

echo "Ответ API:"
echo "$TEST_RESPONSE" | jq '.'
echo ""

echo "✅ Проверьте логи agent-service:"
echo "   Должно быть: 'Using WhatsApp number from direction for test'"
echo "   С номером: +77074480854"
echo ""

sleep 2

echo "================================"
echo "🧪 ТЕСТ 2: Проверка в Facebook"
echo "================================"
echo ""

# Извлекаем adset_id из ответа
ADSET_ID=$(echo "$TEST_RESPONSE" | jq -r '.adset_id // empty')

if [ -n "$ADSET_ID" ]; then
  echo "✅ AdSet создан: $ADSET_ID"
  echo ""
  echo "📋 Проверить в Facebook Ads Manager:"
  echo "   https://business.facebook.com/adsmanager/manage/adsets?act=1090206589147369&selected_adset_ids=${ADSET_ID}"
  echo ""
  echo "   Должен быть WhatsApp номер: +77074480854"
else
  echo "❌ Не удалось получить adset_id"
fi

echo ""
echo "================================"
echo "✅ Тесты завершены!"
echo "================================"
