#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

echo "🔍 ТЕСТИРОВАНИЕ UNUSED CREATIVES"
echo "================================"
echo ""

# Проверяем что scoring agent запущен
echo "1️⃣ Проверка доступности Scoring Agent..."
if curl -s http://localhost:9091/health > /dev/null 2>&1; then
  echo "✅ Scoring Agent доступен"
else
  echo "❌ Scoring Agent НЕ доступен на localhost:9091"
  echo "   Запустите: cd services/agent-brain && npm start"
  exit 1
fi

echo ""
echo "2️⃣ Запрос к Scoring Agent..."
echo ""

RESPONSE=$(curl -s -X POST http://localhost:9091/api/scoring/run \
  -H "Content-Type: application/json" \
  -d "{\"user_id\": \"$USER_ID\"}")

echo "$RESPONSE" | jq '.' > /tmp/scoring-response.json

echo "✅ Ответ сохранен в /tmp/scoring-response.json"
echo ""

# Проверяем наличие unused_creatives
echo "3️⃣ Проверка unused_creatives..."
echo ""

UNUSED_COUNT=$(echo "$RESPONSE" | jq '.unused_creatives | length' 2>/dev/null)

if [ "$UNUSED_COUNT" = "null" ]; then
  echo "❌ Поле unused_creatives НЕ НАЙДЕНО в ответе!"
  echo ""
  echo "Структура ответа:"
  echo "$RESPONSE" | jq 'keys'
else
  echo "✅ Поле unused_creatives найдено!"
  echo "📊 Количество неиспользованных креативов: $UNUSED_COUNT"
  echo ""
  
  if [ "$UNUSED_COUNT" -gt 0 ]; then
    echo "🎯 НЕИСПОЛЬЗОВАННЫЕ КРЕАТИВЫ:"
    echo "$RESPONSE" | jq '.unused_creatives[] | {id, title, recommended_objective}'
  else
    echo "ℹ️  Все креативы используются в активных ads"
  fi
fi

echo ""
echo "4️⃣ Полный ответ (первые 100 строк):"
echo ""
head -100 /tmp/scoring-response.json

