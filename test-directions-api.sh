#!/bin/bash

echo "🧪 Тест API направлений"
echo "======================="
echo ""

# Тестируем с разными UUID
echo "1️⃣  Тест с пустым UUID (должен вернуть пустой массив):"
curl -s 'http://localhost:8082/directions?userAccountId=00000000-0000-0000-0000-000000000000' | jq '.'
echo ""
echo ""

# Создадим тестовое направление
echo "2️⃣  Создаём тестовое направление..."
TEST_UUID="00000000-0000-0000-0000-000000000001"

RESPONSE=$(curl -s -X POST 'http://localhost:8082/directions' \
  -H 'Content-Type: application/json' \
  -d "{
    \"userAccountId\": \"$TEST_UUID\",
    \"name\": \"Тестовое направление\",
    \"objective\": \"whatsapp\",
    \"daily_budget_cents\": 5000,
    \"target_cpl_cents\": 200
  }")

echo "$RESPONSE" | jq '.'
echo ""
echo ""

# Проверяем что направление создалось
echo "3️⃣  Проверяем созданное направление:"
curl -s "http://localhost:8082/directions?userAccountId=$TEST_UUID" | jq '.'
echo ""
echo ""

echo "✅ Тест завершён!"
echo ""
echo "📝 Теперь откройте в браузере:"
echo "   http://localhost:8081/profile"
echo ""
echo "   И проверьте консоль браузера (F12 → Console)"

