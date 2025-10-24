#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
API_URL="http://localhost:8082"

# Направления
DIR_CM="6c7423d0-9ec6-45e3-a108-7924c57effea"  # Цифровой менеджер (+77074480854)
DIR_AI="7a25d7a2-e0a1-4acb-987b-9ecd4e9a7ba9"  # AI-таргетолог (+77074094375)

# Креативы
CREATIVE_CM="4ede49fb-f92b-4c6c-91ae-cb8f06d603af"
CREATIVE_AI="5b5f5d1b-ddf2-4be5-8385-18fc0d8ee1e7"

echo "================================"
echo "🧪 ТЕСТ: Ручной запуск (Direction.CreateAdSetWithCreatives)"
echo "================================"
echo ""

echo "📋 ТЕСТ 1: Ручной запуск для 'Цифровой менеджер'"
echo "   Направление: $DIR_CM"
echo "   Креатив: $CREATIVE_CM"
echo "   Ожидаемый WhatsApp: +77074480854"
echo ""

RESPONSE1=$(curl -s -X POST "${API_URL}/api/agent/actions" \
  -H 'Content-Type: application/json' \
  -d "{
    \"idempotencyKey\": \"test-manual-cm-$(date +%s)\",
    \"source\": \"test\",
    \"account\": {
      \"userAccountId\": \"${USER_ID}\"
    },
    \"actions\": [
      {
        \"type\": \"Direction.CreateAdSetWithCreatives\",
        \"params\": {
          \"direction_id\": \"${DIR_CM}\",
          \"user_creative_ids\": [\"${CREATIVE_CM}\"],
          \"auto_activate\": false
        }
      }
    ]
  }")

echo "Результат:"
ADSET1=$(echo "$RESPONSE1" | jq -r '.results[0].adset_id // empty')
if [ -n "$ADSET1" ]; then
  echo "✅ AdSet создан: $ADSET1"
  echo "$RESPONSE1" | jq '.results[0] | {direction_name, campaign_id, adset_id, ads_count}'
else
  echo "❌ Ошибка:"
  echo "$RESPONSE1" | jq '.'
fi
echo ""

echo "🔍 ПРОВЕРЬТЕ В ЛОГАХ:"
echo "   'Using WhatsApp number from direction'"
echo "   phone_number: +77074480854"
echo "   source: direction"
echo ""
echo "---"
echo ""

sleep 2

echo "📋 ТЕСТ 2: Ручной запуск для 'AI-таргетолог'"
echo "   Направление: $DIR_AI"
echo "   Креатив: $CREATIVE_AI"
echo "   Ожидаемый WhatsApp: +77074094375"
echo ""

RESPONSE2=$(curl -s -X POST "${API_URL}/api/agent/actions" \
  -H 'Content-Type: application/json' \
  -d "{
    \"idempotencyKey\": \"test-manual-ai-$(date +%s)\",
    \"source\": \"test\",
    \"account\": {
      \"userAccountId\": \"${USER_ID}\"
    },
    \"actions\": [
      {
        \"type\": \"Direction.CreateAdSetWithCreatives\",
        \"params\": {
          \"direction_id\": \"${DIR_AI}\",
          \"user_creative_ids\": [\"${CREATIVE_AI}\"],
          \"auto_activate\": false
        }
      }
    ]
  }")

echo "Результат:"
ADSET2=$(echo "$RESPONSE2" | jq -r '.results[0].adset_id // empty')
if [ -n "$ADSET2" ]; then
  echo "✅ AdSet создан: $ADSET2"
  echo "$RESPONSE2" | jq '.results[0] | {direction_name, campaign_id, adset_id, ads_count}'
else
  echo "❌ Ошибка:"
  echo "$RESPONSE2" | jq '.'
fi
echo ""

echo "🔍 ПРОВЕРЬТЕ В ЛОГАХ:"
echo "   'Using WhatsApp number from direction'"
echo "   phone_number: +77074094375"
echo "   source: direction"
echo ""

echo "================================"
echo "✅ Ручной запуск протестирован!"
echo "================================"
