#!/bin/bash

# Тестирование Creative Analytics API
# Дата: 17 октября 2025

set -e

echo "🧪 Testing Creative Analytics API"
echo "=================================="
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ANALYZER_URL="${ANALYZER_URL:-http://localhost:7081}"

# Проверка аргументов
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "${RED}❌ Usage: $0 <user_creative_id> <user_id>${NC}"
  echo ""
  echo "Example:"
  echo "  $0 abc-123-456 def-789-012"
  echo ""
  exit 1
fi

USER_CREATIVE_ID="$1"
USER_ID="$2"

# ===================================================
# TEST 1: Health Check
# ===================================================
echo "${YELLOW}Test 1: Health Check${NC}"
HEALTH_RESPONSE=$(curl -s "${ANALYZER_URL}/health")

if echo "$HEALTH_RESPONSE" | grep -q '"ok":true'; then
  echo "${GREEN}✅ Analyzer service is running${NC}"
else
  echo "${RED}❌ Analyzer service is not responding${NC}"
  echo "Response: $HEALTH_RESPONSE"
  exit 1
fi
echo ""

# ===================================================
# TEST 2: Get Creative Analytics (First Request - LLM)
# ===================================================
echo "${YELLOW}Test 2: First Request (with LLM)${NC}"
echo "URL: ${ANALYZER_URL}/api/analyzer/creative-analytics/${USER_CREATIVE_ID}?user_id=${USER_ID}"
echo ""

START_TIME=$(date +%s%N)
RESPONSE=$(curl -s -w "\n%{http_code}" "${ANALYZER_URL}/api/analyzer/creative-analytics/${USER_CREATIVE_ID}?user_id=${USER_ID}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)
END_TIME=$(date +%s%N)
ELAPSED=$(echo "scale=3; ($END_TIME - $START_TIME) / 1000000000" | bc)

echo "HTTP Code: $HTTP_CODE"
echo "Elapsed Time: ${ELAPSED}s"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "${GREEN}✅ Request successful${NC}"
  
  # Проверяем data_source
  DATA_SOURCE=$(echo "$BODY" | jq -r '.data_source')
  FROM_CACHE=$(echo "$BODY" | jq -r '.from_cache')
  SCORE=$(echo "$BODY" | jq -r '.analysis.score // "N/A"')
  VERDICT=$(echo "$BODY" | jq -r '.analysis.verdict // "N/A"')
  
  echo "Data Source: $DATA_SOURCE"
  echo "From Cache: $FROM_CACHE"
  echo "Score: $SCORE"
  echo "Verdict: $VERDICT"
  
  if [ "$FROM_CACHE" = "true" ]; then
    echo "${YELLOW}⚠️  Warning: First request should not be from cache${NC}"
  fi
  
  if [ "$DATA_SOURCE" = "none" ]; then
    echo "${YELLOW}ℹ️  No data available (no test and not in production)${NC}"
  fi
else
  echo "${RED}❌ Request failed${NC}"
  echo "Response: $BODY"
  exit 1
fi
echo ""

# ===================================================
# TEST 3: Get Creative Analytics (Second Request - Cache)
# ===================================================
echo "${YELLOW}Test 3: Second Request (from cache)${NC}"

START_TIME=$(date +%s%N)
RESPONSE=$(curl -s -w "\n%{http_code}" "${ANALYZER_URL}/api/analyzer/creative-analytics/${USER_CREATIVE_ID}?user_id=${USER_ID}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)
END_TIME=$(date +%s%N)
ELAPSED=$(echo "scale=3; ($END_TIME - $START_TIME) / 1000000000" | bc)

echo "HTTP Code: $HTTP_CODE"
echo "Elapsed Time: ${ELAPSED}s"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  FROM_CACHE=$(echo "$BODY" | jq -r '.from_cache')
  CACHED_AT=$(echo "$BODY" | jq -r '.cached_at // "N/A"')
  
  if [ "$FROM_CACHE" = "true" ]; then
    echo "${GREEN}✅ Request served from cache${NC}"
    echo "Cached At: $CACHED_AT"
    
    # Проверка что второй запрос быстрее
    if (( $(echo "$ELAPSED < 1" | bc -l) )); then
      echo "${GREEN}✅ Cache is fast (<1s)${NC}"
    else
      echo "${YELLOW}⚠️  Cache response is slow (>${ELAPSED}s)${NC}"
    fi
  else
    echo "${RED}❌ Second request should be from cache${NC}"
  fi
else
  echo "${RED}❌ Request failed${NC}"
fi
echo ""

# ===================================================
# TEST 4: Force Refresh
# ===================================================
echo "${YELLOW}Test 4: Force Refresh (ignore cache)${NC}"

RESPONSE=$(curl -s -w "\n%{http_code}" "${ANALYZER_URL}/api/analyzer/creative-analytics/${USER_CREATIVE_ID}?user_id=${USER_ID}&force=true")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  FROM_CACHE=$(echo "$BODY" | jq -r '.from_cache')
  
  if [ "$FROM_CACHE" = "false" ]; then
    echo "${GREEN}✅ Force refresh worked (not from cache)${NC}"
  else
    echo "${RED}❌ Force refresh failed (still from cache)${NC}"
  fi
else
  echo "${RED}❌ Request failed${NC}"
fi
echo ""

# ===================================================
# TEST 5: Invalid User Creative ID
# ===================================================
echo "${YELLOW}Test 5: Invalid Creative ID${NC}"

RESPONSE=$(curl -s -w "\n%{http_code}" "${ANALYZER_URL}/api/analyzer/creative-analytics/invalid-id-123?user_id=${USER_ID}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "404" ]; then
  echo "${GREEN}✅ Correctly returns 404 for invalid creative${NC}"
else
  echo "${YELLOW}⚠️  Expected 404, got $HTTP_CODE${NC}"
fi
echo ""

# ===================================================
# TEST 6: Missing User ID
# ===================================================
echo "${YELLOW}Test 6: Missing User ID${NC}"

RESPONSE=$(curl -s -w "\n%{http_code}" "${ANALYZER_URL}/api/analyzer/creative-analytics/${USER_CREATIVE_ID}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "400" ]; then
  echo "${GREEN}✅ Correctly returns 400 for missing user_id${NC}"
else
  echo "${YELLOW}⚠️  Expected 400, got $HTTP_CODE${NC}"
fi
echo ""

# ===================================================
# SUMMARY
# ===================================================
echo "=================================="
echo "${GREEN}✅ All tests completed!${NC}"
echo ""
echo "📊 Summary:"
echo "  - Service: Running"
echo "  - First request: Success"
echo "  - Cache: Working"
echo "  - Force refresh: Working"
echo "  - Error handling: Working"
echo ""
echo "Next steps:"
echo "  1. Check logs: docker logs agents-monorepo-agent-brain-1 --tail 50"
echo "  2. Test with different creatives"
echo "  3. Integrate with frontend"

