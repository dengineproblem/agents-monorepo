#!/bin/bash

echo "================================"
echo "🧪 Тестирование proxy конфигурации"
echo "================================"
echo ""

echo "1️⃣ Тест: /api/analyzer → должен идти на 7081 (analyzer)"
RESP1=$(curl -s http://localhost:8081/api/analyzer/health 2>&1)
echo "Ответ:"
echo "$RESP1" | jq '.' 2>/dev/null || echo "$RESP1"
echo ""

if echo "$RESP1" | grep -q "creative-analyzer"; then
  echo "✅ Запрос к /api/analyzer корректно проксируется на analyzer (7081)"
else
  echo "❌ Проблема с proxy для /api/analyzer"
fi
echo ""
echo "---"
echo ""

echo "2️⃣ Тест: /api/health → должен идти на 8082 (agent-service)"
RESP2=$(curl -s http://localhost:8081/api/health 2>&1)
echo "Ответ:"
echo "$RESP2" | jq '.' 2>/dev/null || echo "$RESP2"
echo ""

if echo "$RESP2" | grep -q "ok"; then
  echo "✅ Запрос к /api корректно проксируется на agent-service (8082)"
else
  echo "❌ Проблема с proxy для /api"
fi
echo ""

echo "================================"
echo "✅ Тестирование завершено!"
echo "================================"
