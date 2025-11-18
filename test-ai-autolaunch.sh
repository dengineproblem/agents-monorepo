#!/bin/bash

# Скрипт для тестирования AI-версии автолонча

echo "🤖 Тестирование AI-версии автолонча"
echo "===================================="
echo ""

# Проверяем наличие OPENAI_API_KEY
if [ -f .env.agent ]; then
    if grep -q "OPENAI_API_KEY=sk-" .env.agent 2>/dev/null; then
        echo "✅ OPENAI_API_KEY найден в .env.agent"
    else
        echo "❌ OPENAI_API_KEY не настроен в .env.agent"
        echo "   Добавьте: OPENAI_API_KEY=sk-..."
        exit 1
    fi
else
    echo "❌ Файл .env.agent не найден"
    exit 1
fi

# Проверяем CAMPAIGN_BUILDER_MODEL
if grep -q "CAMPAIGN_BUILDER_MODEL=" .env.agent 2>/dev/null; then
    MODEL=$(grep "CAMPAIGN_BUILDER_MODEL=" .env.agent | cut -d '=' -f2)
    echo "✅ Модель: $MODEL"
else
    echo "⚠️  CAMPAIGN_BUILDER_MODEL не указана, будет использована gpt-4o по умолчанию"
fi

echo ""
echo "📝 Инструкция по тестированию:"
echo ""
echo "1. Запустите agent-service локально:"
echo "   cd services/agent-service"
echo "   npm run dev"
echo ""
echo "2. Запустите фронтенд:"
echo "   cd services/frontend"
echo "   npm run dev"
echo ""
echo "3. Откройте браузер: http://localhost:5173"
echo ""
echo "4. Нажмите кнопку 'Autostart' и смотрите логи:"
echo ""
echo "   В терминале agent-service вы должны увидеть:"
echo "   - 'Building campaign action...'"
echo "   - 'Calling OpenAI API'"
echo "   - 'Action created from LLM'"
echo "   - Выбранные креативы с reasoning"
echo ""
echo "5. Альтернативно - тестовый запрос через curl:"
echo ""
echo "   curl -X POST http://localhost:8082/campaign-builder/auto-launch \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{"
echo "       \"user_account_id\": \"YOUR_USER_ID\","
echo "       \"objective\": \"whatsapp\""
echo "     }'"
echo ""
echo "🔍 Мониторинг логов AI-агента:"
echo ""
echo "   # В отдельном терминале:"
echo "   tail -f services/agent-service/logs/*.log | grep -E '(LLM|buildCampaignAction|OpenAI|selected_creatives)'"
echo ""
echo "🎯 Что искать в логах как доказательство работы AI:"
echo "   - 'Building campaign action...'"
echo "   - 'Calling OpenAI with model: gpt-4o'"
echo "   - 'available_creatives' с risk_score"
echo "   - 'selected_creatives' с reason (почему выбран)"
echo "   - 'reasoning' от LLM"
echo "   - 'confidence: high|medium|low'"
echo ""






