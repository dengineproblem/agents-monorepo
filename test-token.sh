#!/bin/bash
# Скрипт для проверки токена Facebook и WhatsApp permissions

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

# Получаем токен из БД через API
echo "Получаем данные пользователя..."
TOKEN=$(docker exec -i $(docker ps -q -f name=postgres) psql -U postgres -d moltbot -t -c "SELECT access_token FROM user_accounts WHERE id = '$USER_ID';" 2>/dev/null | tr -d ' ')

if [ -z "$TOKEN" ]; then
  echo "❌ Не удалось получить токен из БД"
  exit 1
fi

echo "✓ Токен получен (длина: ${#TOKEN} символов)"
echo ""

# Проверяем permissions токена
echo "=== Проверка permissions токена ==="
curl -s "https://graph.facebook.com/v20.0/me/permissions?access_token=$TOKEN" | jq '.'
echo ""

# Проверяем WhatsApp Business Accounts
echo "=== WhatsApp Business Accounts ==="
curl -s "https://graph.facebook.com/v20.0/me/businesses?fields=id,name,whatsapp_business_accounts{id,name,phone_number}&access_token=$TOKEN" | jq '.'
echo ""

# Проверяем страницу
echo "=== Проверка страницы 114323838439928 ==="
curl -s "https://graph.facebook.com/v20.0/114323838439928?fields=id,name,access_token&access_token=$TOKEN" | jq '.'
