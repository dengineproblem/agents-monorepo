-- =====================================================
-- ТЕСТОВЫЕ SQL ЗАПРОСЫ для проверки унифицированной системы метрик
-- =====================================================

-- 1. Проверить структуру таблицы после миграции
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'creative_metrics_history'
ORDER BY ordinal_position;

-- 2. Проверить индексы
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'creative_metrics_history';

-- 3. Проверить метрики сохраненные agent-brain (с ad_id)
SELECT 
  ad_id,
  creative_id,
  impressions,
  clicks,
  leads,
  cpl,
  date,
  created_at
FROM creative_metrics_history
WHERE ad_id IS NOT NULL
ORDER BY date DESC, ad_id
LIMIT 20;

-- 4. Проверить статистику по пользователю
SELECT 
  user_account_id,
  date,
  COUNT(*) as records_count,
  COUNT(DISTINCT ad_id) as unique_ads,
  COUNT(DISTINCT creative_id) as unique_creatives,
  SUM(impressions) as total_impressions,
  SUM(leads) as total_leads,
  AVG(cpl) as avg_cpl
FROM creative_metrics_history
WHERE user_account_id = 'YOUR_USER_ID' -- заменить на реальный ID
  AND date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY user_account_id, date
ORDER BY date DESC;

-- 5. Проверить метрики конкретного креатива (агрегация по всем ads)
SELECT 
  creative_id,
  date,
  COUNT(*) as ads_count,
  SUM(impressions) as total_impressions,
  SUM(clicks) as total_clicks,
  SUM(leads) as total_leads,
  SUM(spend) as total_spend,
  ROUND((SUM(clicks)::DECIMAL / NULLIF(SUM(impressions), 0) * 100)::NUMERIC, 2) as calculated_ctr,
  ROUND((SUM(spend)::DECIMAL / NULLIF(SUM(impressions), 0) * 1000)::NUMERIC, 2) as calculated_cpm,
  ROUND((SUM(spend)::DECIMAL / NULLIF(SUM(leads), 0))::NUMERIC, 2) as calculated_cpl
FROM creative_metrics_history
WHERE creative_id = 'YOUR_CREATIVE_ID' -- заменить на реальный ID
  AND date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY creative_id, date
ORDER BY date DESC;

-- 6. Сравнить старые записи (adset_id без ad_id) vs новые (с ad_id)
SELECT 
  'Old records (adset level)' as type,
  COUNT(*) as count,
  MIN(date) as earliest_date,
  MAX(date) as latest_date
FROM creative_metrics_history
WHERE adset_id IS NOT NULL AND ad_id IS NULL

UNION ALL

SELECT 
  'New records (ad level)' as type,
  COUNT(*) as count,
  MIN(date) as earliest_date,
  MAX(date) as latest_date
FROM creative_metrics_history
WHERE ad_id IS NOT NULL;

-- 7. Проверить связь с ad_creative_mapping
SELECT 
  cm.ad_id,
  cm.creative_id,
  cm.impressions,
  cm.leads,
  cm.cpl,
  acm.user_creative_id,
  acm.direction_id,
  acm.source
FROM creative_metrics_history cm
INNER JOIN ad_creative_mapping acm ON cm.ad_id = acm.ad_id
WHERE cm.date = CURRENT_DATE
LIMIT 20;

-- 8. Найти креативы БЕЗ метрик (нужен fallback на FB API)
SELECT 
  uc.id as user_creative_id,
  uc.title,
  uc.fb_creative_id_whatsapp,
  uc.created_at
FROM user_creatives uc
LEFT JOIN creative_metrics_history cm 
  ON uc.fb_creative_id_whatsapp = cm.creative_id
  AND cm.date >= CURRENT_DATE - INTERVAL '2 days'
WHERE uc.user_id = 'YOUR_USER_ID' -- заменить на реальный ID
  AND uc.status = 'ready'
  AND cm.id IS NULL
ORDER BY uc.created_at DESC;

-- 9. Проверить метрики из creative_tests (должны также попадать в creative_metrics_history)
SELECT 
  ct.id as test_id,
  ct.user_creative_id,
  ct.ad_id,
  ct.impressions as test_impressions,
  ct.leads as test_leads,
  cm.impressions as history_impressions,
  cm.leads as history_leads,
  cm.date as history_date
FROM creative_tests ct
LEFT JOIN creative_metrics_history cm 
  ON ct.ad_id = cm.ad_id
  AND cm.date >= CURRENT_DATE - INTERVAL '2 days'
WHERE ct.status = 'completed'
  AND ct.completed_at >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY ct.completed_at DESC
LIMIT 20;

-- 10. Performance check: сколько времени занимает чтение метрик
EXPLAIN ANALYZE
SELECT *
FROM creative_metrics_history
WHERE user_account_id = 'YOUR_USER_ID' -- заменить на реальный ID
  AND creative_id IN ('creative_1', 'creative_2', 'creative_3') -- заменить на реальные IDs
  AND date = CURRENT_DATE;

