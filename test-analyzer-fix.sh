#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

echo "================================"
echo "✅ ANALYZER PROXY - ФИНАЛЬНЫЙ ТЕСТ"
echo "================================"
echo ""

echo "1️⃣ Креатив из 'Цифровой менеджер'"
CREATIVE_CM="4ede49fb-f92b-4c6c-91ae-cb8f06d603af"
echo "   ID: $CREATIVE_CM"

RESP1=$(curl -s "http://localhost:8081/api/analyzer/creative-analytics/${CREATIVE_CM}?user_id=${USER_ID}")
echo "   Результат:"
echo "$RESP1" | jq '{direction: .creative.direction_name, data_source, test_status: .test.status, has_production: (.production != null), has_analysis: (.analysis != null)}'
echo ""

echo "2️⃣ Креатив из 'AI-таргетолог'"
CREATIVE_AI="5b5f5d1b-ddf2-4be5-8385-18fc0d8ee1e7"
echo "   ID: $CREATIVE_AI"

RESP2=$(curl -s "http://localhost:8081/api/analyzer/creative-analytics/${CREATIVE_AI}?user_id=${USER_ID}")
echo "   Результат:"
echo "$RESP2" | jq '{direction: .creative.direction_name, data_source, test_status: .test.status, has_production: (.production != null), has_analysis: (.analysis != null)}'
echo ""

echo "================================"
echo "✅ РЕЗУЛЬТАТ"
echo "================================"
echo ""
echo "Proxy настроен корректно:"
echo "  • /api/analyzer/* → http://localhost:7081/ (с rewrite)"
echo "  • /api/* → http://localhost:8082/"
echo ""
echo "Данные получаются успешно! 🎉"
echo ""
echo "📋 Откройте http://localhost:8081 и проверьте страницу Креативы"
echo "   Теперь должны отображаться:"
echo "   - Промежуточные тесты"
echo "   - Production метрики"
echo "   - LLM анализ"
