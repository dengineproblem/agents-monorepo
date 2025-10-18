#!/bin/bash

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  ТЕСТИРОВАНИЕ ИНСТРУМЕНТОВ ДУБЛИРОВАНИЯ ПЕРЕД ПРОДАКШНОМ      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

USER_ACCOUNT_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

echo "ПОДГОТОВКА:"
echo "1. Включите BRAIN_TEST_MODE=true в docker-compose.yml"
echo "2. Включите FB_VALIDATE_ONLY=true в docker-compose.yml"
echo "3. Пересоберите контейнеры: docker-compose up -d --build"
echo ""
read -p "Нажмите Enter когда будете готовы..."

echo ""
echo "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo "${YELLOW}ЭТАП 1: Провокация Audience.DuplicateAdSetWithAudience${NC}"
echo "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo "Сценарий: 1 ad set с очень дорогим QCPL (8.00 USD при плане 4.00 USD)"
echo ""

RESULT1=$(curl -sS -X POST localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d "{
    \"userAccountId\": \"${USER_ACCOUNT_ID}\",
    \"inputs\": {
      \"dispatch\": true,
      \"overrideCPL\": [
        { \"adset_id\": \"120234845322690463\", \"qcpl\": 8.00 }
      ]
    }
  }")

echo "Проверка planNote на упоминание дубля:"
echo "$RESULT1" | jq -r '.planNote' | grep -i "дубл" && echo "${GREEN}✓ Дубль упомянут в planNote${NC}" || echo "${RED}✗ Дубль НЕ упомянут${NC}"

echo ""
echo "Проверка actions на наличие Audience.DuplicateAdSetWithAudience:"
HAS_AUD_DUP=$(echo "$RESULT1" | jq '.actions[] | select(.type == "Audience.DuplicateAdSetWithAudience")' | wc -l)
if [ "$HAS_AUD_DUP" -gt 0 ]; then
  echo "${GREEN}✓ Action Audience.DuplicateAdSetWithAudience найден${NC}"
  echo "$RESULT1" | jq '.actions[] | select(.type == "Audience.DuplicateAdSetWithAudience")'
else
  echo "${YELLOW}⚠ Action не сгенерирован (возможно, LLM решил иначе - проверьте reportText)${NC}"
  echo "$RESULT1" | jq -r '.reportText' | grep -A 5 "дубл"
fi

echo ""
echo "Статус выполнения в agent-service:"
echo "$RESULT1" | jq '{dispatched, agentResponse}'

echo ""
read -p "Нажмите Enter для следующего теста..."

echo ""
echo "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo "${YELLOW}ЭТАП 2: Провокация реанимации (все ad sets плохие)${NC}"
echo "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo "Сценарий: Все 3 ad sets с QCPL > 8.00 USD"
echo ""

RESULT2=$(curl -sS -X POST localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d "{
    \"userAccountId\": \"${USER_ACCOUNT_ID}\",
    \"inputs\": {
      \"dispatch\": true,
      \"overrideCPL\": [
        { \"adset_id\": \"120234845741880463\", \"qcpl\": 10.00 },
        { \"adset_id\": \"120234845322690463\", \"qcpl\": 12.00 },
        { \"adset_id\": \"120234844633260463\", \"qcpl\": 11.00 }
      ]
    }
  }")

echo "Проверка на Workflow.DuplicateAndPauseOriginal:"
HAS_DUP_PAUSE=$(echo "$RESULT2" | jq '.actions[] | select(.type == "Workflow.DuplicateAndPauseOriginal")' | wc -l)
if [ "$HAS_DUP_PAUSE" -gt 0 ]; then
  echo "${GREEN}✓ Workflow.DuplicateAndPauseOriginal найден${NC}"
  echo "$RESULT2" | jq '.actions[] | select(.type == "Workflow.DuplicateAndPauseOriginal")'
else
  echo "${YELLOW}⚠ Action не сгенерирован (LLM применил best-of-bad стратегию)${NC}"
fi

echo ""
echo "Health Scores всех ad sets:"
echo "$RESULT2" | jq '.trace.adsets[:3] | map({name, hs, cls})'

echo ""
read -p "Нажмите Enter для следующего теста..."

echo ""
echo "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo "${YELLOW}ЭТАП 3: Провокация масштабирования (все успешные)${NC}"
echo "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo "Сценарий: Все ad sets с отличным QCPL < 2.00 USD"
echo ""

RESULT3=$(curl -sS -X POST localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d "{
    \"userAccountId\": \"${USER_ACCOUNT_ID}\",
    \"inputs\": {
      \"dispatch\": true,
      \"overrideCPL\": [
        { \"adset_id\": \"120234845741880463\", \"qcpl\": 1.20 },
        { \"adset_id\": \"120234845322690463\", \"qcpl\": 1.50 },
        { \"adset_id\": \"120234844633260463\", \"qcpl\": 1.30 }
      ]
    }
  }")

echo "Проверка на Workflow.DuplicateKeepOriginalActive:"
HAS_DUP_KEEP=$(echo "$RESULT3" | jq '.actions[] | select(.type == "Workflow.DuplicateKeepOriginalActive")' | wc -l)
if [ "$HAS_DUP_KEEP" -gt 0 ]; then
  echo "${GREEN}✓ Workflow.DuplicateKeepOriginalActive найден${NC}"
  echo "$RESULT3" | jq '.actions[] | select(.type == "Workflow.DuplicateKeepOriginalActive")'
else
  echo "${YELLOW}⚠ Action не сгенерирован (LLM может просто увеличивать бюджеты)${NC}"
fi

echo ""
echo "Решения LLM:"
echo "$RESULT3" | jq '.actions[] | {type, params}'

echo ""
echo "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo "${GREEN}ТЕСТИРОВАНИЕ ЗАВЕРШЕНО${NC}"
echo "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "ВАЖНО:"
echo "1. Все запросы выполнялись с FB_VALIDATE_ONLY=true (изменения НЕ применены в Facebook)"
echo "2. Проверьте логи agent-service для деталей валидации"
echo "3. Если все тесты прошли - можно запускать в продакшн с dispatch=true и FB_VALIDATE_ONLY=false"
echo ""
echo "Для продакшна НЕ ЗАБУДЬТЕ:"
echo "  - BRAIN_TEST_MODE=false"
echo "  - FB_VALIDATE_ONLY=false"
echo "  - dispatch=true (для реального выполнения)"
