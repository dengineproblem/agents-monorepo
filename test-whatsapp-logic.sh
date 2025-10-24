#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
API_URL="http://localhost:8082"

echo "================================"
echo "🧪 Тестирование логики WhatsApp номеров"
echo "================================"
echo ""

# 1. Получаем направления
echo "📋 1. Получение направлений..."
DIRECTIONS=$(curl -s "${API_URL}/api/directions?userAccountId=${USER_ID}")
echo "$DIRECTIONS" | jq '.directions[] | {id, name, objective, whatsapp_phone_number}'
echo ""

# Извлекаем ID направлений
DIR_CM=$(echo "$DIRECTIONS" | jq -r '.directions[] | select(.name == "Цифровой менеджер") | .id')
DIR_AI=$(echo "$DIRECTIONS" | jq -r '.directions[] | select(.name == "AI-таргетолог") | .id')

echo "Цифровой менеджер ID: $DIR_CM"
echo "AI-таргетолог ID: $DIR_AI"
echo ""

# 2. Получаем креативы для каждого направления
echo "📋 2. Получение креативов..."
CREATIVE_CM=$(curl -s "${API_URL}/api/creatives?userId=${USER_ID}&directionId=${DIR_CM}&status=ready" | jq -r '.creatives[0].id // empty')
CREATIVE_AI=$(curl -s "${API_URL}/api/creatives?userId=${USER_ID}&directionId=${DIR_AI}&status=ready" | jq -r '.creatives[0].id // empty')

echo "Креатив для Цифрового менеджера: $CREATIVE_CM"
echo "Креатив для AI-таргетолога: $CREATIVE_AI"
echo ""

echo "================================"
echo "✅ Данные подготовлены!"
echo "================================"
