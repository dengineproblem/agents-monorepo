-- Креативы для "Цифровой менеджер"
SELECT id, title, direction_id, status 
FROM user_creatives 
WHERE user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' 
  AND direction_id = '6c7423d0-9ec6-45e3-a108-7924c57effea'
  AND status = 'ready'
LIMIT 1;

-- Креативы для "AI-таргетолог"
SELECT id, title, direction_id, status 
FROM user_creatives 
WHERE user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' 
  AND direction_id = '7a25d7a2-e0a1-4acb-987b-9ecd4e9a7ba9'
  AND status = 'ready'
LIMIT 1;
