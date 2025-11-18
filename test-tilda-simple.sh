#!/bin/bash

# Simple Tilda Integration Test
# Quick test of the new Tilda → AmoCRM flow

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
API_URL="${API_URL:-http://localhost:8082}"
USER_ACCOUNT_ID="${USER_ACCOUNT_ID:-0f559eb0-53fa-4b6a-a51b-5d3e15e5864b}"
TEST_AD_ID="${TEST_AD_ID:-test_tilda_ad_123456}"

echo -e "${BLUE}=== Tilda Integration Quick Test ===${NC}"
echo ""
echo "Configuration:"
echo "  API: $API_URL"
echo "  User: $USER_ACCOUNT_ID"
echo "  Test Ad ID: $TEST_AD_ID"
echo ""

# Generate test data
TEST_PHONE="+79$(date +%s | tail -c 10)"
TEST_NAME="Тестовый Лид $(date +%H:%M:%S)"

echo -e "${YELLOW}[1/2]${NC} Sending test lead with ad_id..."
echo ""

# Test 1: Lead WITH ad_id (should map to creative)
RESPONSE=$(curl -s -X POST "$API_URL/leads" \
  -H "Content-Type: application/json" \
  -d "{
    \"userAccountId\": \"$USER_ACCOUNT_ID\",
    \"name\": \"$TEST_NAME\",
    \"phone\": \"$TEST_PHONE\",
    \"email\": \"test@tilda.test\",
    \"message\": \"Test message from Tilda form\",
    \"utm_source\": \"tilda\",
    \"utm_medium\": \"website\",
    \"utm_campaign\": \"test_campaign\",
    \"utm_content\": \"$TEST_AD_ID\",
    \"ad_id\": \"$TEST_AD_ID\"
  }")

echo "Response:"
echo "$RESPONSE" | jq '.'
echo ""

if echo "$RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    LEAD_ID=$(echo "$RESPONSE" | jq -r '.leadId')
    echo -e "${GREEN}✓ Lead created: ID = $LEAD_ID${NC}"
    
    # Show query to check the lead
    echo ""
    echo -e "${YELLOW}Check lead in database:${NC}"
    echo "SELECT id, name, phone, source_id, creative_id, direction_id, utm_content"
    echo "FROM leads WHERE id = $LEAD_ID;"
    echo ""
    echo -e "${YELLOW}Expected result:${NC}"
    echo "  - source_id = '$TEST_AD_ID'"
    echo "  - creative_id = 'test-tilda-creative-id' (if mapping exists)"
    echo "  - direction_id = 'test-tilda-direction-id' (if mapping exists)"
else
    echo -e "${RED}✗ Failed to create lead${NC}"
    exit 1
fi
echo ""

# Test 2: Lead WITHOUT ad_id
echo -e "${YELLOW}[2/2]${NC} Sending test lead WITHOUT ad_id..."
TEST_PHONE_2="+79$(date +%s | tail -c 10)"

RESPONSE2=$(curl -s -X POST "$API_URL/leads" \
  -H "Content-Type: application/json" \
  -d "{
    \"userAccountId\": \"$USER_ACCOUNT_ID\",
    \"name\": \"Лид без ad_id\",
    \"phone\": \"$TEST_PHONE_2\",
    \"utm_source\": \"tilda\",
    \"utm_campaign\": \"test_no_mapping\"
  }")

echo "Response:"
echo "$RESPONSE2" | jq '.'
echo ""

if echo "$RESPONSE2" | jq -e '.success' > /dev/null 2>&1; then
    LEAD_ID_2=$(echo "$RESPONSE2" | jq -r '.leadId')
    echo -e "${GREEN}✓ Lead created: ID = $LEAD_ID_2${NC}"
    echo ""
    echo -e "${YELLOW}Expected result:${NC}"
    echo "  - source_id = NULL"
    echo "  - creative_id = NULL"
    echo "  - direction_id = NULL"
else
    echo -e "${RED}✗ Failed to create lead${NC}"
fi
echo ""

echo -e "${BLUE}=== Test Summary ===${NC}"
echo ""
echo "✓ Lead WITH ad_id: $LEAD_ID (phone: $TEST_PHONE)"
echo "✓ Lead WITHOUT ad_id: $LEAD_ID_2 (phone: $TEST_PHONE_2)"
echo ""
echo -e "${YELLOW}To verify results, run:${NC}"
echo "SELECT id, phone, source_id, creative_id, direction_id FROM leads WHERE id IN ($LEAD_ID, $LEAD_ID_2);"
echo ""
echo -e "${YELLOW}To cleanup test leads:${NC}"
echo "DELETE FROM leads WHERE phone IN ('$TEST_PHONE', '$TEST_PHONE_2');"
echo ""



