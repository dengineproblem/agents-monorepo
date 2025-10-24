#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

echo "================================"
echo "🧪 Проверка analyzer для разных креативов"
echo "================================"
echo ""

# Список креативов для проверки
CREATIVES=(
  "4ede49fb-f92b-4c6c-91ae-cb8f06d603af"
  "5b5f5d1b-ddf2-4be5-8385-18fc0d8ee1e7"
)

for CREATIVE_ID in "${CREATIVES[@]}"; do
  echo "Креатив: $CREATIVE_ID"
  
  RESP=$(curl -s "http://localhost:8081/api/analyzer/creative-analytics/${CREATIVE_ID}?user_id=${USER_ID}")
  
  echo "  Статус теста: $(echo "$RESP" | jq -r '.test.status // "нет теста"')"
  echo "  data_source: $(echo "$RESP" | jq -r '.data_source')"
  echo "  Impressions: $(echo "$RESP" | jq -r '.test.metrics.impressions // 0')"
  
  if [ "$(echo "$RESP" | jq -r '.test.status')" == "completed" ]; then
    echo "  ✅ Тест завершён"
    echo "  Полный ответ:"
    echo "$RESP" | jq '.'
  fi
  
  echo ""
done

echo "================================"
echo "Скажите ID креатива с завершённым тестом"
echo "================================"
