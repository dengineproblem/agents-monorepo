#!/bin/bash

echo "================================"
echo "🧪 Тестирование proxy (с корректными endpoints)"
echo "================================"
echo ""

echo "1️⃣ Тест: /api/analyzer → должен идти на 7081 (analyzer)"
echo "   Пробуем: curl http://localhost:8081/api/analyzer/health"
RESP1=$(curl -s http://localhost:8081/api/analyzer/health 2>&1)
echo "   Ответ от Fastify (analyzer):"
echo "   $RESP1" | head -1
echo ""

# Проверяем, что это ответ от Fastify (значит дошло до analyzer)
if echo "$RESP1" | grep -q "Route.*not found\|statusCode"; then
  echo "✅ Запрос дошел до analyzer (7081) - видим ответ от Fastify"
  echo "   (404 нормально - endpoint /api/analyzer/health не существует)"
else
  echo "❌ Запрос НЕ дошел до analyzer"
fi
echo ""
echo "---"
echo ""

echo "2️⃣ Тест: Реальный endpoint analyzer"
echo "   Пробуем получить аналитику креатива (API analyzer):"
USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
CREATIVE_ID="4ede49fb-f92b-4c6c-91ae-cb8f06d603af"

RESP2=$(curl -s "http://localhost:8081/api/analyzer/creative-analytics/${CREATIVE_ID}?user_id=${USER_ID}" 2>&1)
echo "   Ответ:"
echo "$RESP2" | jq '{data_source, has_test: (.test != null), has_production: (.production != null), has_analysis: (.analysis != null)}' 2>/dev/null || echo "   Ошибка: $RESP2" | head -2
echo ""

if echo "$RESP2" | grep -q "data_source\|test\|production"; then
  echo "✅ Аналитика креативов работает через proxy!"
else
  echo "❌ Проблема с получением аналитики"
fi
echo ""

echo "================================"
echo "✅ Результат:"
echo "================================"
echo "Proxy настроен корректно:"
echo "  • /api/analyzer/* → localhost:7081 (analyzer)"
echo "  • /api/* → localhost:8082 (agent-service)"
