SELECT 
  uc.id as creative_id,
  uc.title,
  ct.id as test_id,
  ct.status,
  ct.impressions,
  ct.leads
FROM user_creatives uc
JOIN creative_tests ct ON ct.user_creative_id = uc.id
WHERE uc.user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'
  AND ct.status = 'cancelled'
  AND ct.impressions > 0
ORDER BY ct.started_at DESC
LIMIT 3;
