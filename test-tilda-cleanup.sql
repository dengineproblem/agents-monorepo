-- Cleanup script for Tilda Integration Test
-- Run this to remove test data after testing

-- Configuration variables (replace before running)
\set user_account_id '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'
\set test_ad_id 'test_tilda_ad_123456'

-- Show what will be deleted
SELECT 'Test leads to be deleted:' as info;
SELECT id, name, phone, source_id, creative_id 
FROM leads 
WHERE source_id = :'test_ad_id' 
   OR creative_id = 'test-tilda-creative-id';

-- Delete test leads
DELETE FROM leads 
WHERE source_id = :'test_ad_id' 
   OR creative_id = 'test-tilda-creative-id';

-- Delete test ad mapping
DELETE FROM ad_creative_mapping 
WHERE ad_id = :'test_ad_id';

-- Delete test creative
DELETE FROM user_creatives 
WHERE id = 'test-tilda-creative-id';

-- Delete test direction
DELETE FROM account_directions 
WHERE id = 'test-tilda-direction-id';

-- Verify cleanup
SELECT 
  'Cleanup completed!' as status,
  (SELECT COUNT(*) FROM account_directions WHERE id = 'test-tilda-direction-id') as directions_remaining,
  (SELECT COUNT(*) FROM user_creatives WHERE id = 'test-tilda-creative-id') as creatives_remaining,
  (SELECT COUNT(*) FROM ad_creative_mapping WHERE ad_id = :'test_ad_id') as mappings_remaining,
  (SELECT COUNT(*) FROM leads WHERE source_id = :'test_ad_id') as leads_remaining;




