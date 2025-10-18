#!/bin/bash

# Тестовый скрипт для Campaign Builder Agent
# Использование: ./test-campaign-builder.sh [user_account_id]

set -e

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Конфигурация
API_URL="${API_URL:-http://localhost:8082}"
USER_ACCOUNT_ID="${1:-}" # Первый аргумент или пустая строка

echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}Campaign Builder Agent - Test${NC}"
echo -e "${GREEN}================================${NC}\n"

# Проверка health
echo -e "${YELLOW}[1] Checking service health...${NC}"
curl -s "$API_URL/health" | jq '.'
echo -e "${GREEN}✓ Service is healthy${NC}\n"

# Если user_account_id не передан, пытаемся найти его в Supabase
if [ -z "$USER_ACCOUNT_ID" ]; then
  echo -e "${YELLOW}[2] USER_ACCOUNT_ID not provided. Please set it manually.${NC}"
  echo -e "${RED}Usage: ./test-campaign-builder.sh <user_account_id>${NC}"
  exit 1
fi

echo -e "${YELLOW}Using USER_ACCOUNT_ID: $USER_ACCOUNT_ID${NC}\n"

# Тест 1: Получить доступные креативы
echo -e "${YELLOW}[3] Fetching available creatives...${NC}"
CREATIVES_RESPONSE=$(curl -s "$API_URL/api/campaign-builder/available-creatives?user_account_id=$USER_ACCOUNT_ID&objective=whatsapp")
echo "$CREATIVES_RESPONSE" | jq '.'

CREATIVES_COUNT=$(echo "$CREATIVES_RESPONSE" | jq -r '.count // 0')
if [ "$CREATIVES_COUNT" -eq 0 ]; then
  echo -e "${RED}✗ No creatives found. Please create some creatives first.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Found $CREATIVES_COUNT creatives${NC}\n"

# Тест 2: Получить бюджетные ограничения
echo -e "${YELLOW}[4] Fetching budget constraints...${NC}"
BUDGET_RESPONSE=$(curl -s "$API_URL/api/campaign-builder/budget-constraints?user_account_id=$USER_ACCOUNT_ID")
echo "$BUDGET_RESPONSE" | jq '.'

AVAILABLE_BUDGET=$(echo "$BUDGET_RESPONSE" | jq -r '.constraints.available_budget_usd // 0')
echo -e "${GREEN}✓ Available budget: \$$AVAILABLE_BUDGET${NC}\n"

# Тест 3: Preview плана кампании
echo -e "${YELLOW}[5] Generating campaign preview...${NC}"
PREVIEW_RESPONSE=$(curl -s -X POST "$API_URL/api/campaign-builder/preview" \
  -H 'Content-Type: application/json' \
  -d "{
    \"user_account_id\": \"$USER_ACCOUNT_ID\",
    \"objective\": \"whatsapp\",
    \"campaign_name\": \"Test Campaign - $(date +%Y%m%d-%H%M%S)\",
    \"requested_budget_cents\": 150000,
    \"additional_context\": \"Test campaign from script\"
  }")

echo "$PREVIEW_RESPONSE" | jq '.'

PREVIEW_SUCCESS=$(echo "$PREVIEW_RESPONSE" | jq -r '.success // false')
if [ "$PREVIEW_SUCCESS" != "true" ]; then
  echo -e "${RED}✗ Preview failed: $(echo $PREVIEW_RESPONSE | jq -r '.error // "unknown error"')${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Preview generated successfully${NC}\n"
echo -e "${YELLOW}Plan:${NC}"
echo "$PREVIEW_RESPONSE" | jq '.plan'

# Тест 4: Создание кампании (опционально)
echo -e "\n${YELLOW}[6] Do you want to create this campaign? (y/n)${NC}"
read -r CREATE_CAMPAIGN

if [ "$CREATE_CAMPAIGN" = "y" ]; then
  echo -e "${YELLOW}Creating campaign...${NC}"
  
  LAUNCH_RESPONSE=$(curl -s -X POST "$API_URL/api/campaign-builder/auto-launch" \
    -H 'Content-Type: application/json' \
    -d "{
      \"user_account_id\": \"$USER_ACCOUNT_ID\",
      \"objective\": \"whatsapp\",
      \"campaign_name\": \"Test Campaign - $(date +%Y%m%d-%H%M%S)\",
      \"requested_budget_cents\": 150000,
      \"additional_context\": \"Test campaign from script\",
      \"auto_activate\": false
    }")
  
  echo "$LAUNCH_RESPONSE" | jq '.'
  
  LAUNCH_SUCCESS=$(echo "$LAUNCH_RESPONSE" | jq -r '.success // false')
  if [ "$LAUNCH_SUCCESS" = "true" ]; then
    CAMPAIGN_ID=$(echo "$LAUNCH_RESPONSE" | jq -r '.campaign_id')
    ADSET_ID=$(echo "$LAUNCH_RESPONSE" | jq -r '.adset_id')
    ADS_COUNT=$(echo "$LAUNCH_RESPONSE" | jq -r '.ads | length')
    
    echo -e "${GREEN}✓ Campaign created successfully!${NC}"
    echo -e "${GREEN}  Campaign ID: $CAMPAIGN_ID${NC}"
    echo -e "${GREEN}  AdSet ID: $ADSET_ID${NC}"
    echo -e "${GREEN}  Ads created: $ADS_COUNT${NC}"
    echo -e "${GREEN}  Status: PAUSED (ready for review)${NC}\n"
    
    echo -e "${YELLOW}View campaign in Facebook Ads Manager:${NC}"
    echo -e "https://business.facebook.com/adsmanager/manage/campaigns?act=YOUR_AD_ACCOUNT_ID"
  else
    ERROR=$(echo "$LAUNCH_RESPONSE" | jq -r '.error // "unknown error"')
    STAGE=$(echo "$LAUNCH_RESPONSE" | jq -r '.stage // "unknown"')
    echo -e "${RED}✗ Campaign creation failed at stage: $STAGE${NC}"
    echo -e "${RED}  Error: $ERROR${NC}"
  fi
else
  echo -e "${YELLOW}Campaign creation skipped${NC}"
fi

echo -e "\n${GREEN}================================${NC}"
echo -e "${GREEN}Test completed${NC}"
echo -e "${GREEN}================================${NC}\n"

