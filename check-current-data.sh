#!/bin/bash

echo "🔍 ПРОВЕРКА ТЕКУЩИХ ДАННЫХ В SUPABASE"
echo "======================================"
echo ""

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
SUPABASE_URL="https://pvthvtgejcxdlxfdmdau.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2dGh2dGdlamN4ZGx4ZmRtZGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyNzkwMTgsImV4cCI6MjA3Mzg1NTAxOH0.Uo48P1GrDQGOUCB7g6XrXIXjjZNmjI3BflqyLaKhSuk"

echo "Получаем default_ad_settings для WhatsApp..."
echo ""

RESULT=$(curl -s -X GET "$SUPABASE_URL/rest/v1/default_ad_settings?user_id=eq.$USER_ID&campaign_goal=eq.whatsapp" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY")

if echo "$RESULT" | jq -e '.[0]' > /dev/null 2>&1; then
  echo "✅ Настройки найдены!"
  echo ""
  echo "📊 Текущие данные:"
  echo "$RESULT" | jq '.[0] | {
    campaign_goal,
    cities,
    age_min,
    age_max,
    gender,
    description
  }'
  echo ""
  
  CITIES=$(echo "$RESULT" | jq -r '.[0].cities')
  echo "🎯 Поле cities:"
  echo "$CITIES"
  echo ""
  
  echo "🤖 КАК ЭТО РАСПОЗНАЕТСЯ В КОДЕ:"
  echo ""
  
  # Простая симуляция распознавания
  if echo "$CITIES" | grep -E '^\["[A-Z]{2}"(,"[A-Z]{2}")*\]$' > /dev/null; then
    echo "✅ Это СТРАНЫ (коды 2 символа, uppercase)"
    echo "   Преобразуется в: {\"countries\": $CITIES}"
  elif echo "$CITIES" | grep -E '^\[[0-9]' > /dev/null; then
    echo "✅ Это ГОРОДА (числовые ID)"
    echo "   Преобразуется в: {\"cities\": [...]}"
  else
    echo "⚠️  Формат нужно проверить"
    echo "   Должно быть: [\"RU\",\"KZ\"] для стран"
    echo "   Или: [\"2420877\",\"2452344\"] для городов"
  fi
else
  echo "❌ Настройки НЕ найдены!"
  echo ""
  echo "Нужно создать запись в default_ad_settings"
fi

echo ""
echo "======================================"
