-- SQL Setup for Tilda Integration Test
-- Run this before executing test-tilda-integration.sh
-- Replace USER_ACCOUNT_ID with your actual user account ID

-- Configuration variables (replace before running)
\set user_account_id '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'
\set test_ad_id 'test_tilda_ad_123456'

-- Step 1: Create test direction
INSERT INTO account_directions (id, user_account_id, name, objective, status, created_at)
VALUES (
  'test-tilda-direction-id'::uuid,
  :'user_account_id'::uuid,
  'Test Tilda Direction',
  'OUTCOME_LEADS',
  'active',
  NOW()
)
ON CONFLICT (id) DO UPDATE 
SET 
  name = EXCLUDED.name,
  objective = EXCLUDED.objective,
  status = EXCLUDED.status,
  updated_at = NOW();

-- Step 2: Create test creative
INSERT INTO user_creatives (id, user_id, direction_id, title, status, created_at)
VALUES (
  'test-tilda-creative-id'::uuid,
  :'user_account_id'::uuid,
  'test-tilda-direction-id'::uuid,
  'Test Tilda Creative',
  'active',
  NOW()
)
ON CONFLICT (id) DO UPDATE
SET 
  title = EXCLUDED.title,
  direction_id = EXCLUDED.direction_id,
  updated_at = NOW();

-- Step 3: Create ad_creative_mapping (this is the key for ad_id → creative mapping)
INSERT INTO ad_creative_mapping (ad_id, user_creative_id, direction_id, user_id, source, created_at)
VALUES (
  :'test_ad_id',
  'test-tilda-creative-id'::uuid,
  'test-tilda-direction-id'::uuid,
  :'user_account_id'::uuid,
  'tilda_test',
  NOW()
)
ON CONFLICT (ad_id) DO UPDATE
SET 
  user_creative_id = EXCLUDED.user_creative_id,
  direction_id = EXCLUDED.direction_id;

-- Verify setup
SELECT 
  'Setup completed!' as status,
  (SELECT COUNT(*) FROM account_directions WHERE id = 'test-tilda-direction-id') as directions_count,
  (SELECT COUNT(*) FROM user_creatives WHERE id = 'test-tilda-creative-id') as creatives_count,
  (SELECT COUNT(*) FROM ad_creative_mapping WHERE ad_id = :'test_ad_id') as mappings_count;

-- Display created data
SELECT 'Created Direction:' as info;
SELECT id, name, objective, status FROM account_directions WHERE id = 'test-tilda-direction-id';

SELECT 'Created Creative:' as info;
SELECT id, title, direction_id, status FROM user_creatives WHERE id = 'test-tilda-creative-id';

SELECT 'Created Ad Mapping:' as info;
SELECT ad_id, user_creative_id, direction_id, source FROM ad_creative_mapping WHERE ad_id = :'test_ad_id';



