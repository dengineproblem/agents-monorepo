#!/bin/bash

# Прямой тест AI-версии автолонча через curl

echo "🤖 Прямой тест AI автолонча"
echo "============================"
echo ""

# Проверяем что agent-service запущен
if ! curl -s http://localhost:8082/health > /dev/null 2>&1; then
    echo "❌ agent-service не запущен на порту 8082"
    echo ""
    echo "Запустите его:"
    echo "  cd services/agent-service"
    echo "  npm run dev"
    exit 1
fi

echo "✅ agent-service запущен"
echo ""

# Получаем user_id из localStorage (если есть)
# Или используем тестовый ID
USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b" # ID из ваших логов

echo "📤 Отправляем запрос на AI автолонч..."
echo "   User ID: $USER_ID"
echo "   Objective: whatsapp"
echo ""

# Выполняем запрос с выводом подробных логов
curl -v -X POST http://localhost:8082/campaign-builder/auto-launch \
  -H 'Content-Type: application/json' \
  -d "{
    \"user_account_id\": \"$USER_ID\",
    \"objective\": \"whatsapp\",
    \"auto_activate\": false
  }" 2>&1 | tee /tmp/ai-autolaunch-response.txt

echo ""
echo ""
echo "✅ Запрос выполнен"
echo ""
echo "🔍 Теперь проверьте логи agent-service на наличие:"
echo "   - 'Building campaign action...'"
echo "   - 'Calling OpenAI with model: gpt-4o'"
echo "   - 'Action created from LLM'"
echo "   - 'selected_creatives' с reasoning"
echo ""
echo "📄 Полный ответ сохранен в /tmp/ai-autolaunch-response.txt"






