#!/bin/bash

# Скрипт для получения истории сообщений через GreenAPI
# lastIncomingMessages возвращает последние входящие сообщения

ID_INSTANCE="7105366498"
API_TOKEN="65ba9804825f4a3891b244d06cf786deb438734842884daba3"
MINUTES=40000  # ~месяц

echo "🚀 Получение истории WhatsApp сообщений через GreenAPI"
echo "📱 Instance ID: $ID_INSTANCE"
echo "⏱️  Период: $MINUTES минут"
echo ""

# Выполняем запрос
curl -X GET \
  "https://api.green-api.com/waInstance${ID_INSTANCE}/lastIncomingMessages/${API_TOKEN}?minutes=${MINUTES}" \
  -H "Content-Type: application/json" \
  -o greenapi_history_${MINUTES}min.json

echo ""
echo "✅ Запрос выполнен!"
echo "📊 Количество сообщений:"
cat greenapi_history_${MINUTES}min.json | jq '. | length'

echo ""
echo "📁 Файл сохранен: greenapi_history_${MINUTES}min.json"

