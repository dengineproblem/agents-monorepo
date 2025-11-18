#!/bin/bash

# Test script for Tilda → AmoCRM integration via ad_id mapping
# Tests the new flow: Tilda webhook → leads (with source_id) → creative mapping

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:8082}"
USER_ACCOUNT_ID="${USER_ACCOUNT_ID:-0f559eb0-53fa-4b6a-a51b-5d3e15e5864b}"
TEST_AD_ID="test_tilda_ad_$(date +%s)"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Tilda Integration Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo -e "  API URL: $API_URL"
echo -e "  User Account ID: $USER_ACCOUNT_ID"
echo -e "  Test Ad ID: $TEST_AD_ID"
echo ""

# Step 1: Check if API is running
echo -e "${BLUE}[1/6]${NC} Checking API availability..."
if curl -s -f "$API_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} API is running"
else
    echo -e "${RED}✗${NC} API is not responding at $API_URL"
    echo -e "${YELLOW}Tip:${NC} Make sure agent-service is running: docker-compose up agent-service"
    exit 1
fi
echo ""

# Step 2: Setup test data in database
echo -e "${BLUE}[2/6]${NC} Setting up test data in database..."

# SQL script to create test data
SETUP_SQL=$(cat << 'EOF'
-- Create test direction
INSERT INTO account_directions (id, user_account_id, name, objective, status)
VALUES (
  'test-tilda-direction-id'::uuid,
  :user_account_id::uuid,
  'Test Tilda Direction',
  'OUTCOME_LEADS',
  'active'
)
ON CONFLICT (id) DO UPDATE 
SET name = EXCLUDED.name;

-- Create test creative
INSERT INTO user_creatives (id, user_id, direction_id, title, status)
VALUES (
  'test-tilda-creative-id'::uuid,
  :user_account_id::uuid,
  'test-tilda-direction-id'::uuid,
  'Test Tilda Creative',
  'active'
)
ON CONFLICT (id) DO UPDATE
SET title = EXCLUDED.title;

-- Create ad_creative_mapping
INSERT INTO ad_creative_mapping (ad_id, user_creative_id, direction_id, user_id, source)
VALUES (
  :test_ad_id,
  'test-tilda-creative-id'::uuid,
  'test-tilda-direction-id'::uuid,
  :user_account_id::uuid,
  'tilda_test'
)
ON CONFLICT (ad_id) DO UPDATE
SET user_creative_id = EXCLUDED.user_creative_id;

SELECT 'Test data created successfully' as result;
EOF
)

# Execute SQL (you need to replace this with actual execution)
echo -e "${YELLOW}Note:${NC} You need to execute the following SQL manually or configure DB connection:"
echo ""
echo "$SETUP_SQL" | sed "s/:user_account_id/'$USER_ACCOUNT_ID'/g" | sed "s/:test_ad_id/'$TEST_AD_ID'/g"
echo ""
read -p "Press Enter after executing SQL setup (or Ctrl+C to abort)..."
echo ""

# Step 3: Send test webhook (Tilda lead with ad_id in utm_content)
echo -e "${BLUE}[3/6]${NC} Sending test webhook from Tilda..."

TEST_PHONE="+79$(date +%s | tail -c 10)"
TEST_LEAD_DATA=$(cat << EOF
{
  "userAccountId": "$USER_ACCOUNT_ID",
  "name": "Тестовый Лид Tilda",
  "phone": "$TEST_PHONE",
  "email": "test@tilda.test",
  "message": "Тестовое сообщение с формы Tilda",
  "utm_source": "tilda",
  "utm_medium": "website",
  "utm_campaign": "test_campaign",
  "utm_content": "$TEST_AD_ID"
}
EOF
)

echo -e "${YELLOW}Request payload:${NC}"
echo "$TEST_LEAD_DATA" | jq '.'
echo ""

RESPONSE=$(curl -s -X POST "$API_URL/leads" \
  -H "Content-Type: application/json" \
  -d "$TEST_LEAD_DATA")

echo -e "${YELLOW}Response:${NC}"
echo "$RESPONSE" | jq '.'
echo ""

# Check if request was successful
if echo "$RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    LEAD_ID=$(echo "$RESPONSE" | jq -r '.leadId')
    echo -e "${GREEN}✓${NC} Lead created successfully! Lead ID: $LEAD_ID"
else
    echo -e "${RED}✗${NC} Failed to create lead"
    echo -e "${YELLOW}Response:${NC} $RESPONSE"
    exit 1
fi
echo ""

# Step 4: Verify lead in database
echo -e "${BLUE}[4/6]${NC} Verifying lead in database..."

VERIFY_SQL=$(cat << EOF
SELECT 
  id,
  name,
  phone,
  source_type,
  source_id,
  creative_id,
  direction_id,
  utm_source,
  utm_campaign,
  utm_content,
  created_at
FROM leads
WHERE phone = '$TEST_PHONE'
ORDER BY created_at DESC
LIMIT 1;
EOF
)

echo -e "${YELLOW}Execute this query to verify:${NC}"
echo "$VERIFY_SQL"
echo ""
read -p "Press Enter to continue..."
echo ""

# Step 5: Test without ad_id (should create lead but without creative mapping)
echo -e "${BLUE}[5/6]${NC} Testing lead without ad_id (negative test)..."

TEST_PHONE_NO_AD="+79$(date +%s | tail -c 10)"
TEST_LEAD_NO_AD=$(cat << EOF
{
  "userAccountId": "$USER_ACCOUNT_ID",
  "name": "Лид без ad_id",
  "phone": "$TEST_PHONE_NO_AD",
  "utm_source": "tilda",
  "utm_campaign": "test_no_ad"
}
EOF
)

RESPONSE_NO_AD=$(curl -s -X POST "$API_URL/leads" \
  -H "Content-Type: application/json" \
  -d "$TEST_LEAD_NO_AD")

if echo "$RESPONSE_NO_AD" | jq -e '.success' > /dev/null 2>&1; then
    LEAD_ID_NO_AD=$(echo "$RESPONSE_NO_AD" | jq -r '.leadId')
    echo -e "${GREEN}✓${NC} Lead created without ad_id. Lead ID: $LEAD_ID_NO_AD"
    echo -e "${YELLOW}Note:${NC} This lead should have NULL creative_id and direction_id"
else
    echo -e "${RED}✗${NC} Failed to create lead without ad_id"
fi
echo ""

# Step 6: Summary
echo -e "${BLUE}[6/6]${NC} Test Summary"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}✓ Test completed!${NC}"
echo ""
echo -e "${YELLOW}What to verify:${NC}"
echo "1. Lead with ad_id ($TEST_PHONE) should have:"
echo "   - source_id = '$TEST_AD_ID'"
echo "   - creative_id = 'test-tilda-creative-id'"
echo "   - direction_id = 'test-tilda-direction-id'"
echo ""
echo "2. Lead without ad_id ($TEST_PHONE_NO_AD) should have:"
echo "   - source_id = NULL"
echo "   - creative_id = NULL"
echo "   - direction_id = NULL"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Verify leads in database using the queries above"
echo "2. Test AmoCRM webhook for sales (separate test)"
echo "3. Configure Tilda form with webhook URL: $API_URL/leads"
echo "4. Configure Facebook Ads with UTM: utm_content={{ad.id}}"
echo ""
echo -e "${BLUE}========================================${NC}"

# Cleanup option
echo ""
read -p "Do you want to cleanup test data? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Execute this SQL to cleanup:${NC}"
    cat << EOF
-- Cleanup test data
DELETE FROM leads WHERE phone IN ('$TEST_PHONE', '$TEST_PHONE_NO_AD');
DELETE FROM ad_creative_mapping WHERE ad_id = '$TEST_AD_ID';
DELETE FROM user_creatives WHERE id = 'test-tilda-creative-id';
DELETE FROM account_directions WHERE id = 'test-tilda-direction-id';
EOF
fi



