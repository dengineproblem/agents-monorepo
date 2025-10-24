#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
CREATIVE_ID="4ede49fb-f92b-4c6c-91ae-cb8f06d603af"

echo "================================"
echo "🔍 Диагностика аналитики креативов"
echo "================================"
echo ""

echo "1️⃣ Проверка через frontend proxy (8081)"
echo "   URL: http://localhost:8081/api/analyzer/creative-analytics/${CREATIVE_ID}"
RESP1=$(curl -s "http://localhost:8081/api/analyzer/creative-analytics/${CREATIVE_ID}?user_id=${USER_ID}")
echo "   Ответ:"
echo "$RESP1" | jq '.' 2>/dev/null || echo "$RESP1"
echo ""

echo "2️⃣ Проверка напрямую к analyzer (7081)"
echo "   URL: http://localhost:7081/api/analyzer/creative-analytics/${CREATIVE_ID}"
RESP2=$(curl -s "http://localhost:7081/api/analyzer/creative-analytics/${CREATIVE_ID}?user_id=${USER_ID}")
echo "   Ответ:"
echo "$RESP2" | jq '.' 2>/dev/null || echo "$RESP2"
echo ""

echo "3️⃣ Сравнение ответов"
if [ "$RESP1" == "$RESP2" ]; then
  echo "✅ Ответы идентичны - proxy работает корректно"
else
  echo "❌ Ответы отличаются - проблема с proxy!"
fi
echo ""

echo "4️⃣ Анализ данных"
DATA_SOURCE=$(echo "$RESP1" | jq -r '.data_source // "null"')
HAS_TEST=$(echo "$RESP1" | jq -r '.test != null')
HAS_PRODUCTION=$(echo "$RESP1" | jq -r '.production != null')
HAS_ANALYSIS=$(echo "$RESP1" | jq -r '.analysis != null')

echo "   data_source: $DATA_SOURCE"
echo "   test: $HAS_TEST"
echo "   production: $HAS_PRODUCTION"
echo "   analysis: $HAS_ANALYSIS"
echo ""

if [ "$DATA_SOURCE" == "null" ] || [ "$DATA_SOURCE" == "null" ]; then
  echo "⚠️  Нет данных для этого креатива!"
  echo "   Возможные причины:"
  echo "   - Креатив не запускался (не было тестов)"
  echo "   - Нет данных в creative_tests таблице"
  echo "   - Нет данных из Facebook API"
fi

