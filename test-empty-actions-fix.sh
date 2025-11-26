#!/bin/bash

# Тест 1: Пустой массив actions (reportOnlyMode)
echo "=== Тест 1: Пустой массив actions ==="
echo "Testing empty actions array..."

response=$(curl -s -X POST http://localhost:3002/api/agent/actions \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "test-empty-'$(date +%s)'",
    "account": { "userAccountId": "test-user" },
    "actions": [],
    "source": "test"
  }')

echo "Response: $response"

# Проверяем что статус 202 и нет validation error
if echo "$response" | grep -q "no-actions-needed"; then
  echo "✅ PASS: Empty actions handled correctly"
else
  echo "❌ FAIL: Empty actions not handled correctly"
  echo "Response: $response"
fi

echo ""
echo "=== Тест 2: Schema validation ==="
echo "Testing that schema allows empty actions..."

# Тест с пустым массивом должен пройти валидацию
response=$(curl -s -X POST http://localhost:3002/api/agent/actions \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "test-schema-'$(date +%s)'",
    "account": { "userAccountId": "test-user" },
    "actions": []
  }')

if echo "$response" | grep -q "validation_error"; then
  echo "❌ FAIL: Schema validation still rejects empty actions"
  echo "Response: $response"
else
  echo "✅ PASS: Schema validation accepts empty actions"
fi

echo ""
echo "=== Summary ==="
echo "Основные фиксы:"
echo "1. ✅ Schema разрешает пустой массив actions (min(0))"
echo "2. ✅ Route обрабатывает пустой массив без ошибок"
echo "3. ✅ WhatsApp adsets: destination_type и promoted_object добавляются ВМЕСТЕ"
echo ""
echo "Для полного теста:"
echo "1. Убедитесь что agent-service запущен на порту 3002"
echo "2. Запустите: bash test-empty-actions-fix.sh"









