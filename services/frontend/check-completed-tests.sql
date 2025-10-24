-- Креативы с завершёнными тестами для user_id
SELECT 
  uc.id as creative_id,
  uc.title,
  ct.id as test_id,
  ct.status,
  ct.impressions,
  ct.reach,
  ct.leads,
  ct.spend_cents,
  ct.cpl_cents,
  ct.llm_score,
  ct.llm_verdict,
  ct.started_at,
  ct.completed_at
FROM user_creatives uc
JOIN creative_tests ct ON ct.user_creative_id = uc.id
WHERE uc.user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'
  AND ct.status = 'completed'
  AND ct.impressions > 0
ORDER BY ct.completed_at DESC
LIMIT 5;
