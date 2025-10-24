SELECT 
  llm_score,
  llm_verdict,
  LEFT(llm_reasoning, 100) as reasoning_preview,
  updated_at
FROM creative_tests
WHERE user_creative_id = '5b5f5d1b-ddf2-4be5-8385-18fc0d8ee1e7';
