#!/bin/bash

# Тест AI-автолонча на продакшн сервере

echo "🚀 Тестирование AI-автолонча на СЕРВЕРЕ"
echo "========================================"
echo ""

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

echo "Отправляем запрос на ПРОДАКШН..."
echo "User: performante ($USER_ID)"
echo ""

# Тестируем на продакшне
curl -X POST https://app.performanteaiagency.com/api/campaign-builder/auto-launch \
  -H 'Content-Type: application/json' \
  -d "{
    \"user_account_id\": \"$USER_ID\",
    \"objective\": \"whatsapp\",
    \"auto_activate\": false
  }"

echo ""
echo ""
echo "✅ Запрос отправлен!"
echo ""
echo "Теперь на сервере выполните:"
echo "  docker-compose logs agent-service --tail 100 | grep -E '(Building campaign action|Calling OpenAI|Action created from LLM|selected_creatives|reasoning)'"
echo ""







