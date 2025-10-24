#!/bin/bash

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

echo "🔍 Ищем креативы с завершёнными тестами..."
echo ""

# Получаем креативы с завершёнными тестами из БД
psql "$DATABASE_URL" -c "
SELECT 
  uc.id as creative_id,
  uc.title,
  ct.status as test_status,
  ct.impressions,
  ct.leads,
  ct.completed_at
FROM user_creatives uc
JOIN creative_tests ct ON ct.user_creative_id = uc.id
WHERE uc.user_id = '$USER_ID'
  AND ct.status = 'completed'
  AND ct.impressions > 0
ORDER BY ct.completed_at DESC
LIMIT 3;
" 2>/dev/null || echo "Нет подключения к БД"

