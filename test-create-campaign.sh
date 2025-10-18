#!/bin/bash

# Тест нового action CreateCampaignWithCreative
# Использование: ./test-create-campaign.sh

set -e

echo "🧪 Тестирование CreateCampaignWithCreative action"
echo ""

# Проверяем переменные окружения
if [ -z "$USER_ACCOUNT_ID" ]; then
  echo "❌ Не установлена переменная USER_ACCOUNT_ID"
  echo "Используй: export USER_ACCOUNT_ID='your-uuid-here'"
  exit 1
fi

if [ -z "$USER_CREATIVE_ID" ]; then
  echo "⚠️  Не установлена переменная USER_CREATIVE_ID"
  echo "Используй: export USER_CREATIVE_ID='creative-uuid-here'"
  echo ""
  echo "Получение списка доступных креативов из Supabase..."
  echo "curl -X GET 'https://your-supabase-url/rest/v1/user_creatives?user_id=eq.$USER_ACCOUNT_ID&status=eq.ready&is_active=eq.true&select=id,title,fb_creative_id_whatsapp,fb_creative_id_instagram_traffic,fb_creative_id_site_leads'"
  exit 1
fi

AGENT_SERVICE_URL=${AGENT_SERVICE_URL:-"http://localhost:4001"}

echo "📋 Параметры теста:"
echo "  USER_ACCOUNT_ID: $USER_ACCOUNT_ID"
echo "  USER_CREATIVE_ID: $USER_CREATIVE_ID"
echo "  AGENT_SERVICE_URL: $AGENT_SERVICE_URL"
echo ""

# Генерируем уникальный idempotency key
IDEM_KEY="test-create-campaign-$(date +%Y%m%d-%H%M%S)"

# Формируем JSON payload
PAYLOAD=$(cat <<EOF
{
  "idempotencyKey": "$IDEM_KEY",
  "source": "test",
  "account": {
    "userAccountId": "$USER_ACCOUNT_ID"
  },
  "actions": [
    {
      "type": "CreateCampaignWithCreative",
      "params": {
        "user_creative_id": "$USER_CREATIVE_ID",
        "objective": "WhatsApp",
        "campaign_name": "TEST — Новая кампания с креативом",
        "adset_name": "TEST — Основной adset",
        "ad_name": "TEST — Объявление 1",
        "daily_budget_cents": 1000
      }
    }
  ]
}
EOF
)

echo "📤 Отправка запроса..."
echo ""

# Отправляем запрос
RESPONSE=$(curl -s -X POST "$AGENT_SERVICE_URL/api/agent/actions" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

echo "📥 Ответ сервера:"
echo "$RESPONSE" | jq '.'

# Проверяем результат
if echo "$RESPONSE" | jq -e '.executionId' > /dev/null 2>&1; then
  EXECUTION_ID=$(echo "$RESPONSE" | jq -r '.executionId')
  echo ""
  echo "✅ Action отправлен успешно!"
  echo "   Execution ID: $EXECUTION_ID"
  echo ""
  
  if echo "$RESPONSE" | jq -e '.executed == true' > /dev/null 2>&1; then
    echo "✅ Action выполнен!"
    echo ""
    echo "🔍 Проверь в Facebook Ads Manager:"
    echo "   - Новая кампания 'TEST — Новая кампания с креативом' (на паузе)"
    echo "   - Внутри неё adset 'TEST — Основной adset' (на паузе)"
    echo "   - Внутри adset объявление 'TEST — Объявление 1' (на паузе)"
  else
    echo "⏳ Action поставлен в очередь (dry run режим?)"
  fi
else
  echo ""
  echo "❌ Ошибка при выполнении action"
  
  if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    ERROR=$(echo "$RESPONSE" | jq -r '.error')
    MESSAGE=$(echo "$RESPONSE" | jq -r '.message // "No message"')
    echo "   Error: $ERROR"
    echo "   Message: $MESSAGE"
  fi
fi

echo ""
echo "📊 Для проверки логов в Supabase:"
echo "   SELECT * FROM agent_executions WHERE idempotency_key = '$IDEM_KEY';"
echo "   SELECT * FROM agent_actions WHERE execution_id = '<execution_id>';"
echo "   SELECT * FROM agent_logs WHERE execution_id = '<execution_id>';"
