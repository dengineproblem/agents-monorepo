-- Проверяем, есть ли реклама с этим Ad ID в creative_tests
SELECT 
  ct.id,
  ct.ad_id,
  ct.user_creative_id,
  uc.title as creative_title,
  uc.direction_id,
  ad.name as direction_name
FROM creative_tests ct
LEFT JOIN user_creatives uc ON ct.user_creative_id = uc.id
LEFT JOIN account_directions ad ON uc.direction_id = ad.id
WHERE ct.ad_id = '120236972823970463';

-- Проверяем, есть ли креатив с этим Instagram URL
SELECT 
  id,
  title,
  direction_id,
  user_id
FROM user_creatives
WHERE title ILIKE '%https://www.instagram.com/p/DQQq2SjAAOn/%'
   OR title ILIKE '%DQQq2SjAAOn%';

-- Проверяем user_account_id из лида
SELECT 
  ua.id,
  ua.email,
  ua.name
FROM user_accounts ua
WHERE ua.id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';
