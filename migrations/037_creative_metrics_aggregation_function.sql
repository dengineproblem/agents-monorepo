-- Migration 037: Creative Metrics Aggregation Function
-- Created: 2025-11-21
-- Description: SQL функция для агрегации метрик креатива через ad_creative_mapping

-- =====================================================
-- ФУНКЦИЯ ДЛЯ АГРЕГАЦИИ МЕТРИК
-- =====================================================

-- Функция для агрегации метрик креатива через ad_creative_mapping
CREATE OR REPLACE FUNCTION get_creative_aggregated_metrics(
  p_user_creative_id UUID,
  p_user_account_id UUID,
  p_days_limit INTEGER DEFAULT 30
)
RETURNS TABLE (
  date DATE,
  total_impressions BIGINT,
  total_reach BIGINT,
  total_clicks BIGINT,
  total_link_clicks BIGINT,
  total_leads BIGINT,
  total_spend NUMERIC,
  avg_ctr NUMERIC,
  avg_cpm NUMERIC,
  avg_cpl NUMERIC,
  avg_frequency NUMERIC,
  total_video_views BIGINT,
  total_video_views_25 BIGINT,
  total_video_views_50 BIGINT,
  total_video_views_75 BIGINT,
  total_video_views_95 BIGINT,
  avg_video_watch_time NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cmh.date,
    SUM(cmh.impressions)::BIGINT as total_impressions,
    SUM(cmh.reach)::BIGINT as total_reach,
    SUM(cmh.clicks)::BIGINT as total_clicks,
    SUM(cmh.link_clicks)::BIGINT as total_link_clicks,
    SUM(cmh.leads)::BIGINT as total_leads,
    SUM(cmh.spend) as total_spend,
    AVG(cmh.ctr) as avg_ctr,
    AVG(cmh.cpm) as avg_cpm,
    AVG(cmh.cpl) as avg_cpl,
    AVG(cmh.frequency) as avg_frequency,
    SUM(cmh.video_views)::BIGINT as total_video_views,
    SUM(cmh.video_views_25_percent)::BIGINT as total_video_views_25,
    SUM(cmh.video_views_50_percent)::BIGINT as total_video_views_50,
    SUM(cmh.video_views_75_percent)::BIGINT as total_video_views_75,
    SUM(cmh.video_views_95_percent)::BIGINT as total_video_views_95,
    AVG(cmh.video_avg_watch_time_sec) as avg_video_watch_time
  FROM creative_metrics_history cmh
  INNER JOIN ad_creative_mapping acm ON cmh.ad_id = acm.ad_id
  WHERE acm.user_creative_id = p_user_creative_id
    AND cmh.user_account_id = p_user_account_id
    AND cmh.source = 'production'
    AND cmh.date >= CURRENT_DATE - (p_days_limit || ' days')::INTERVAL
  GROUP BY cmh.date
  ORDER BY cmh.date DESC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- КОММЕНТАРИИ
-- =====================================================

COMMENT ON FUNCTION get_creative_aggregated_metrics IS 
  'Агрегация метрик креатива по дням. Объединяет данные всех ads одного креатива через ad_creative_mapping. Возвращает только production метрики.';

-- =====================================================
-- ПРИМЕЧАНИЯ
-- =====================================================

/*
ИСПОЛЬЗОВАНИЕ:

-- Получить метрики креатива за последние 30 дней
SELECT * FROM get_creative_aggregated_metrics(
  'user-creative-uuid',  -- UUID креатива
  'user-account-uuid',   -- UUID аккаунта
  30                     -- дней
);

-- Получить метрики за всё время (например, 365 дней)
SELECT * FROM get_creative_aggregated_metrics(
  'user-creative-uuid',
  'user-account-uuid',
  365
);

ЛОГИКА:
1. Ищет все ad_id для креатива через ad_creative_mapping
2. Суммирует абсолютные метрики (impressions, clicks, leads, spend)
3. Усредняет вычисляемые метрики (ctr, cpm, cpl, frequency)
4. Группирует по дням
5. Возвращает только production метрики (исключает тесты)

ПРИМЕР ДАННЫХ:
Креатив используется в 3 ads:
- ad_id: "123" -> 1000 impressions, 5 leads
- ad_id: "789" -> 800 impressions, 3 leads
- ad_id: "999" -> 500 impressions, 2 leads

Результат:
- total_impressions: 2300
- total_leads: 10
*/


