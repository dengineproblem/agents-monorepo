#!/bin/bash

# Тест Campaign Builder API (без реального запуска)
# Показывает структуру запросов для тестирования

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}Campaign Builder API Test Plan${NC}"
echo -e "${GREEN}================================${NC}\n"

API_URL="${API_URL:-http://localhost:8082}"
USER_ACCOUNT_ID="${1:-YOUR_USER_ACCOUNT_ID}"

echo -e "${YELLOW}API URL: $API_URL${NC}"
echo -e "${YELLOW}User Account ID: $USER_ACCOUNT_ID${NC}\n"

# Проверка что сервис запущен
echo -e "${YELLOW}[1] Checking service health...${NC}"
echo "curl -s $API_URL/health"
echo ""

# Тест 1: Получить доступные креативы
echo -e "${YELLOW}[2] Get available creatives${NC}"
cat << 'EOF'
curl -s "$API_URL/api/campaign-builder/available-creatives?user_account_id=YOUR_UUID&objective=whatsapp"
EOF
echo ""

# Тест 2: Получить бюджетные ограничения
echo -e "${YELLOW}[3] Get budget constraints${NC}"
cat << 'EOF'
curl -s "$API_URL/api/campaign-builder/budget-constraints?user_account_id=YOUR_UUID"
EOF
echo ""

# Тест 3: Preview плана (без создания кампании)
echo -e "${YELLOW}[4] Preview campaign plan${NC}"
cat << 'EOF'
curl -X POST "$API_URL/api/campaign-builder/preview" \
  -H 'Content-Type: application/json' \
  -d '{
    "user_account_id": "YOUR_UUID",
    "objective": "whatsapp",
    "campaign_name": "Test Campaign Preview",
    "requested_budget_cents": 150000,
    "additional_context": "Test campaign for demonstration"
  }'
EOF
echo ""

# Тест 4: Auto-launch (создание кампании)
echo -e "${YELLOW}[5] Auto-launch campaign (creates real campaign!)${NC}"
cat << 'EOF'
curl -X POST "$API_URL/api/campaign-builder/auto-launch" \
  -H 'Content-Type: application/json' \
  -d '{
    "user_account_id": "YOUR_UUID",
    "objective": "whatsapp",
    "campaign_name": "Auto Campaign - Test",
    "requested_budget_cents": 150000,
    "additional_context": "Automated test campaign",
    "auto_activate": false
  }'
EOF
echo ""

echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}Test Plan Complete${NC}"
echo -e "${GREEN}================================${NC}\n"

echo -e "${YELLOW}To run actual tests:${NC}"
echo "1. Start the service: cd services/agent-service && npm run dev"
echo "2. Set USER_ACCOUNT_ID: export USER_ACCOUNT_ID=your-uuid"
echo "3. Run: ./test-campaign-builder-api.sh \$USER_ACCOUNT_ID"
echo ""

echo -e "${YELLOW}Expected flow:${NC}"
echo "1. Service checks for active campaigns → pauses them"
echo "2. LLM analyzes available creatives with scoring"
echo "3. LLM generates action (CreateCampaignWithCreative or CreateMultipleAdSets)"
echo "4. Action executes through /api/agent/actions"
echo "5. Campaign(s) created in PAUSED status"
echo ""

echo -e "${YELLOW}Response will include:${NC}"
echo "- execution_id (for tracking)"
echo "- campaign_id, adset_id"
echo "- ads[] (list of created ads)"
echo "- paused_campaigns[] (list of stopped campaigns)"
echo "- action.reasoning (LLM explanation)"
echo "- action.confidence (high/medium/low)"

