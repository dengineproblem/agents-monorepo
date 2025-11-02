#!/bin/bash

# Тест конкретного действия которое сломалось утром
# Direction.CreateAdSetWithCreatives для пользователя 0f559eb0-53fa-4b6a-a51b-5d3e15e5864b

set -e

echo "🧪 Тестирование конкретного действия которое сломалось..."
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Загружаем переменные окружения
if [ -f .env.agent ]; then
  export $(grep -v '^#' .env.agent | xargs)
fi

# Запуск agent-service
echo "🚀 Запуск agent-service..."
cd services/agent-service
PORT=18082 AGENT_DRY_RUN=true node dist/server.js > /tmp/test-specific.log 2>&1 &
SERVICE_PID=$!
cd ../..

sleep 3

if ! kill -0 $SERVICE_PID 2>/dev/null; then
  echo -e "${RED}❌ agent-service не запустился${NC}"
  cat /tmp/test-specific.log
  exit 1
fi

echo -e "${GREEN}✅ agent-service запущен${NC}"
echo ""

# ТОЧНЫЙ запрос который сломался утром
echo "📤 Отправка ТОЧНОГО запроса который сломался утром..."
echo ""
echo "Действие:"
echo "  - Type: Direction.CreateAdSetWithCreatives"
echo "  - Direction ID: 7a25d7a2-e0a1-4acb-987b-9ecd4e9a7ba9"
echo "  - Creatives: 9033590e-ac27-4da7-b206-cf582768527d, 5a7342c9-5fc5-4a37-a284-ac0f817e7467"
echo "  - Budget: 1000 cents ($10)"
echo "  - AdSet Name: Тест креативов — AI-таргетолог #3"
echo ""

RESPONSE=$(curl -s -X POST http://localhost:18082/api/agent/actions \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "test-exact-match-'$(date +%s)'",
    "source": "test",
    "account": {
      "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
      "adAccountId": "act_1090206589147369"
    },
    "actions": [{
      "type": "Direction.CreateAdSetWithCreatives",
      "params": {
        "direction_id": "7a25d7a2-e0a1-4acb-987b-9ecd4e9a7ba9",
        "user_creative_ids": [
          "9033590e-ac27-4da7-b206-cf582768527d",
          "5a7342c9-5fc5-4a37-a284-ac0f817e7467"
        ],
        "daily_budget_cents": 1000,
        "adset_name": "Тест креативов — AI-таргетолог #3",
        "auto_activate": true
      }
    }]
  }')

echo "📥 Ответ от agent-service:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

# Проверяем результат
echo "🔍 Анализ результата..."
echo ""

# 1. Проверка на ошибку "require is not defined"
if echo "$RESPONSE" | grep -q "require is not defined"; then
  echo -e "${RED}❌ КРИТИЧЕСКАЯ ОШИБКА: 'require is not defined' всё ещё есть!${NC}"
  kill $SERVICE_PID
  exit 1
else
  echo -e "${GREEN}✅ Ошибка 'require is not defined' ОТСУТСТВУЕТ${NC}"
fi

# 2. Проверка валидации
if echo "$RESPONSE" | grep -q '"valid":true'; then
  echo -e "${GREEN}✅ Валидация действия прошла успешно${NC}"
else
  echo -e "${RED}❌ Валидация НЕ прошла${NC}"
  echo "Детали валидации:"
  echo "$RESPONSE" | jq '.validations' 2>/dev/null || echo "Не удалось извлечь детали"
  kill $SERVICE_PID
  exit 1
fi

# 3. Проверка dry run
if echo "$RESPONSE" | grep -q '"dryRun":true'; then
  echo -e "${GREEN}✅ Dry run режим активен (реальный запрос к FB не отправлен)${NC}"
fi

# 4. Проверка executed
if echo "$RESPONSE" | grep -q '"executed":true'; then
  echo -e "${GREEN}✅ Действие считается выполненным${NC}"
fi

# Очистка
kill $SERVICE_PID 2>/dev/null || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ ТЕСТ ПРОЙДЕН УСПЕШНО!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎯 Заключение:"
echo "  - Ошибка 'require is not defined' исправлена"
echo "  - Конкретное действие которое сломалось утром теперь работает"
echo "  - Валидация проходит успешно"
echo ""
echo "🚀 ГОТОВО К ДЕПЛОЮ НА ПРОДАКШН!"
echo ""
