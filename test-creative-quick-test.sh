#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  🧪 ЛОКАЛЬНОЕ ТЕСТИРОВАНИЕ QUICK TEST КРЕАТИВОВ                  ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════════╝${NC}"

# Загружаем переменные окружения
source .env.agent

# Проверяем что все сервисы запущены
echo -e "\n${YELLOW}1️⃣  Проверяем сервисы...${NC}"

# Agent Service
if curl -s http://localhost:8080/health | grep -q "ok"; then
  echo -e "${GREEN}✅ Agent Service (8080) работает${NC}"
else
  echo -e "${RED}❌ Agent Service (8080) не работает${NC}"
  echo -e "${YELLOW}Запускаем Agent Service...${NC}"
  pushd services/agent-service > /dev/null
  npm start > /tmp/agent-service.log 2>&1 &
  sleep 3
  popd > /dev/null
fi

# Analyzer Service
if curl -s http://localhost:7081/health 2>/dev/null | grep -q "ok"; then
  echo -e "${GREEN}✅ Analyzer Service (7081) работает${NC}"
else
  echo -e "${YELLOW}⚠️  Analyzer Service (7081) не работает${NC}"
  echo -e "${YELLOW}Запускаем Analyzer Service...${NC}"
  pushd services/agent-brain > /dev/null
  npm run start:analyzer > /tmp/analyzer-service.log 2>&1 &
  sleep 3
  popd > /dev/null
fi

# Параметры теста
USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
CREATIVE_ID="48b5599f-68d5-4142-8e63-5f8d109439b8"

echo -e "\n${YELLOW}2️⃣  Очищаем старые тесты для этого креатива...${NC}"
curl -s -X DELETE "${SUPABASE_URL}/rest/v1/creative_tests?user_creative_id=eq.${CREATIVE_ID}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE}" \
  -H "Prefer: return=minimal" > /dev/null
echo -e "${GREEN}✅ Старые тесты удалены${NC}"

echo -e "\n${YELLOW}3️⃣  Запускаем новый тест...${NC}"
RESPONSE=$(curl -s -X POST http://localhost:8080/api/creative-test/start \
  -H "Content-Type: application/json" \
  -d "{\"user_creative_id\":\"${CREATIVE_ID}\",\"user_id\":\"${USER_ID}\"}")

echo "$RESPONSE" | python3 -m json.tool

TEST_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('test_id',''))" 2>/dev/null)

if [ -z "$TEST_ID" ]; then
  echo -e "${RED}❌ Не удалось создать тест!${NC}"
  exit 1
fi

echo -e "\n${GREEN}✅ Тест создан! Test ID: ${TEST_ID}${NC}"

echo -e "\n${YELLOW}4️⃣  Проверяем название кампании в Facebook...${NC}"
CAMPAIGN_ID=$(curl -s "${SUPABASE_URL}/rest/v1/creative_tests?id=eq.${TEST_ID}&select=campaign_id" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)[0]['campaign_id'])")

ACCESS_TOKEN=$(curl -s "${SUPABASE_URL}/rest/v1/user_accounts?id=eq.${USER_ID}&select=access_token" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)[0]['access_token'])")

CAMPAIGN_NAME=$(curl -s "https://graph.facebook.com/v20.0/${CAMPAIGN_ID}?fields=name&access_token=${ACCESS_TOKEN}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")

echo -e "${BLUE}Campaign Name: ${CAMPAIGN_NAME}${NC}"

if [[ "$CAMPAIGN_NAME" == ТЕСТ* ]]; then
  echo -e "${GREEN}✅ Название начинается с 'ТЕСТ |' - Brain Agent будет игнорировать!${NC}"
else
  echo -e "${RED}❌ ОШИБКА: Название НЕ начинается с 'ТЕСТ |'${NC}"
fi

echo -e "\n${YELLOW}5️⃣  Мониторинг теста...${NC}"
echo -e "${BLUE}Проверяем каждые 30 секунд (cron работает каждые 5 минут)${NC}"
echo -e "${BLUE}Для остановки мониторинга нажми Ctrl+C${NC}\n"

while true; do
  STATUS=$(curl -s "${SUPABASE_URL}/rest/v1/creative_tests?id=eq.${TEST_ID}&select=status,impressions,test_impressions_limit,llm_score,llm_verdict" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE}")
  
  CURRENT_STATUS=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['status'] if d else 'unknown')")
  IMPRESSIONS=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['impressions'] if d else 0)")
  LIMIT=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['test_impressions_limit'] if d else 1000)")
  
  TIMESTAMP=$(date '+%H:%M:%S')
  
  if [ "$CURRENT_STATUS" = "running" ]; then
    echo -e "${YELLOW}[${TIMESTAMP}] Status: RUNNING | Impressions: ${IMPRESSIONS}/${LIMIT}${NC}"
  elif [ "$CURRENT_STATUS" = "completed" ]; then
    LLM_SCORE=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('llm_score','N/A'))")
    LLM_VERDICT=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('llm_verdict','N/A'))")
    
    echo -e "\n${GREEN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ ТЕСТ ЗАВЕРШЕН!                                               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    echo -e "\n${BLUE}📊 РЕЗУЛЬТАТЫ:${NC}"
    echo -e "   Status: ${GREEN}COMPLETED${NC}"
    echo -e "   Impressions: ${IMPRESSIONS}/${LIMIT}"
    echo -e "   LLM Score: ${LLM_SCORE}/100"
    echo -e "   LLM Verdict: ${LLM_VERDICT}"
    
    echo -e "\n${BLUE}📝 ПОЛНЫЙ ОТЧЕТ:${NC}"
    curl -s "${SUPABASE_URL}/rest/v1/creative_tests?id=eq.${TEST_ID}&select=*" \
      -H "apikey: ${SUPABASE_SERVICE_ROLE}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE}" | python3 -m json.tool
    
    break
  else
    echo -e "${RED}[${TIMESTAMP}] Status: ${CURRENT_STATUS}${NC}"
  fi
  
  sleep 30
done

echo -e "\n${GREEN}✅ Тестирование завершено!${NC}"
echo -e "${BLUE}Логи Agent Service: tail -f /tmp/agent-service.log${NC}"
echo -e "${BLUE}Логи Analyzer Service: tail -f /tmp/analyzer-service.log${NC}"

