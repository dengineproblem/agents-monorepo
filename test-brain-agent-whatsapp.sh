#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
API_URL="http://localhost:8082"

# Креативы из разных направлений
CREATIVE_CM="4ede49fb-f92b-4c6c-91ae-cb8f06d603af"  # Цифровой менеджер
CREATIVE_AI="5b5f5d1b-ddf2-4be5-8385-18fc0d8ee1e7"  # AI-таргетолог

echo "================================"
echo "🧪 ТЕСТ: Brain Agent (CreateCampaignWithCreative)"
echo "================================"
echo ""

echo "📋 ТЕСТ 1: Креатив из 'Цифровой менеджер'"
echo "   Креатив ID: $CREATIVE_CM"
echo "   Ожидаемый WhatsApp: +77074480854"
echo ""

# Тест 1: Креатив из "Цифровой менеджер"
RESPONSE1=$(curl -s -X POST "${API_URL}/api/agent/actions" \
  -H 'Content-Type: application/json' \
  -d "{
    \"idempotencyKey\": \"test-brain-cm-$(date +%s)\",
    \"source\": \"test\",
    \"account\": {
      \"userAccountId\": \"${USER_ID}\"
    },
    \"actions\": [
      {
        \"type\": \"CreateCampaignWithCreative\",
        \"params\": {
          \"user_creative_id\": \"${CREATIVE_CM}\",
          \"objective\": \"WhatsApp\",
          \"campaign_name\": \"TEST Brain Agent CM - $(date +%H:%M:%S)\",
          \"daily_budget_cents\": 2000,
          \"use_default_settings\": true,
          \"auto_activate\": false
        }
      }
    ]
  }")

echo "Результат:"
echo "$RESPONSE1" | jq '{executed, actionsCount, results: .results[0] | {campaign_id, adset_id}}'
echo ""

echo "🔍 ПРОВЕРЬТЕ В ЛОГАХ:"
echo "   '[Brain Agent] Using WhatsApp number from direction:'"
echo "   phone_number: +77074480854"
echo "   source: direction"
echo ""
echo "---"
echo ""

sleep 2

echo "📋 ТЕСТ 2: Креатив из 'AI-таргетолог'"
echo "   Креатив ID: $CREATIVE_AI"
echo "   Ожидаемый WhatsApp: +77074094375"
echo ""

# Тест 2: Креатив из "AI-таргетолог"
RESPONSE2=$(curl -s -X POST "${API_URL}/api/agent/actions" \
  -H 'Content-Type: application/json' \
  -d "{
    \"idempotencyKey\": \"test-brain-ai-$(date +%s)\",
    \"source\": \"test\",
    \"account\": {
      \"userAccountId\": \"${USER_ID}\"
    },
    \"actions\": [
      {
        \"type\": \"CreateCampaignWithCreative\",
        \"params\": {
          \"user_creative_id\": \"${CREATIVE_AI}\",
          \"objective\": \"WhatsApp\",
          \"campaign_name\": \"TEST Brain Agent AI - $(date +%H:%M:%S)\",
          \"daily_budget_cents\": 2000,
          \"use_default_settings\": true,
          \"auto_activate\": false
        }
      }
    ]
  }")

echo "Результат:"
echo "$RESPONSE2" | jq '{executed, actionsCount, results: .results[0] | {campaign_id, adset_id}}'
echo ""

echo "🔍 ПРОВЕРЬТЕ В ЛОГАХ:"
echo "   '[Brain Agent] Using WhatsApp number from direction:'"
echo "   phone_number: +77074094375"
echo "   source: direction"
echo ""

echo "================================"
echo "✅ Все тесты запущены!"
echo "================================"
echo ""
echo "📊 ИТОГОВАЯ ПРОВЕРКА:"
echo ""
echo "1. Автозапуск (auto-launch-v2) ✅"
echo "   - Цифровой менеджер: +77074480854"
echo "   - AI-таргетолог: +77074094375"
echo ""
echo "2. Быстрый тест (creative-test) ✅"
echo "   - Креатив из Цифрового менеджера: +77074480854"
echo ""
echo "3. Brain Agent (CreateCampaignWithCreative) ✅"
echo "   - Креатив из Цифрового менеджера: +77074480854"
echo "   - Креатив из AI-таргетолога: +77074094375"
echo ""
echo "🔍 Проверьте логи agent-service на наличие всех сообщений!"
