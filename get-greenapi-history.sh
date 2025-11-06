#!/bin/bash

# Получение истории сообщений через GreenAPI lastIncomingMessages
# Документация: https://green-api.com/docs/api/journals/LastIncomingMessages/

ID_INSTANCE="7105366498"
API_TOKEN="65ba9804825f4a3891b244d06cf786deb438734842884daba3"
MINUTES=1000  # тест

echo "Запрос к GreenAPI..."
echo "Minutes: $MINUTES"

curl -s "https://api.green-api.com/waInstance${ID_INSTANCE}/lastIncomingMessages/${API_TOKEN}?minutes=${MINUTES}" \
  -o greenapi_${MINUTES}min.json

echo "Готово! Проверяем количество сообщений..."
jq '. | length' greenapi_${MINUTES}min.json

echo "Файл сохранен: greenapi_${MINUTES}min.json"

