#!/bin/bash
# Deploy TikTok OAuth Integration to Server

echo "🚀 Deploying TikTok OAuth Integration..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Stopping services...${NC}"
docker-compose stop agent-service frontend

echo -e "${YELLOW}Step 2: Rebuilding agent-service (backend)...${NC}"
docker-compose build agent-service

echo -e "${YELLOW}Step 3: Rebuilding frontend...${NC}"
docker-compose build frontend

echo -e "${YELLOW}Step 4: Starting services...${NC}"
docker-compose up -d agent-service frontend

echo -e "${YELLOW}Step 5: Waiting for services to start...${NC}"
sleep 5

echo -e "${YELLOW}Step 6: Checking service status...${NC}"
docker-compose ps agent-service frontend

echo -e "${YELLOW}Step 7: Checking agent-service logs...${NC}"
docker-compose logs --tail=20 agent-service

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Test OAuth: https://performanteaiagency.com/profile"
echo "2. Click 'Connect TikTok'"
echo "3. Check logs: docker-compose logs -f agent-service | grep -i tiktok"
echo ""
echo "See TIKTOK_OAUTH_TESTING.md for full testing guide"
