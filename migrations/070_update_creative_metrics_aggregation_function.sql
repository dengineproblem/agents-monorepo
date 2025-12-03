-- Migration 070: Update Creative Metrics Aggregation Function for Multi-Account Support
-- Created: 2025-12-03
-- Description: Добавляет параметр p_account_id для фильтрации по рекламному аккаунту в мультиаккаунтном режиме

-- =====================================================
-- УДАЛЕНИЕ СТАРОЙ ВЕРСИИ ФУНКЦИИ
-- =====================================================

-- Удаляем старую версию функции (3 аргумента: UUID, UUID, INTEGER)
DROP FUNCTION IF EXISTS get_creative_aggregated_metrics(UUID, UUID, INTEGER);

-- =====================================================
-- ОБНОВЛЁННАЯ ФУНКЦИЯ ДЛЯ АГРЕГАЦИИ МЕТРИК
-- =====================================================

-- Функция для агрегации метрик креатива через ad_creative_mapping
-- Теперь поддерживает мультиаккаунтный режим через параметр p_account_id
CREATE OR REPLACE FUNCTION get_creative_aggregated_metrics(
  p_user_creative_id UUID,
  p_user_account_id UUID,
  p_account_id UUID DEFAULT NULL,  -- UUID из ad_accounts.id для мультиаккаунтности (NULL для legacy)
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
    -- Мультиаккаунтность: если p_account_id передан, фильтруем по нему
    -- Если NULL (legacy режим), пропускаем все записи
    AND (p_account_id IS NULL OR cmh.account_id = p_account_id)
  GROUP BY cmh.date
  ORDER BY cmh.date DESC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- КОММЕНТАРИИ
-- =====================================================

COMMENT ON FUNCTION get_creative_aggregated_metrics IS
  'Агрегация метрик креатива по дням с поддержкой мультиаккаунтности.
   p_account_id (UUID) - для мультиаккаунтного режима. NULL для legacy режима.
   Объединяет данные всех ads одного креатива через ad_creative_mapping.
   Возвращает только production метрики.';

-- =====================================================
-- ПРИМЕЧАНИЯ
-- =====================================================

/*
ИСПОЛЬЗОВАНИЕ:

-- Legacy режим (без мультиаккаунтности)
SELECT * FROM get_creative_aggregated_metrics(
  'user-creative-uuid',  -- UUID креатива
  'user-account-uuid',   -- UUID пользователя
  NULL,                  -- NULL = legacy режим
  30                     -- дней
);

-- Multi-account режим
SELECT * FROM get_creative_aggregated_metrics(
  'user-creative-uuid',  -- UUID креатива
  'user-account-uuid',   -- UUID пользователя
  'ad-account-uuid',     -- UUID из ad_accounts.id
  30                     -- дней
);

ОБРАТНАЯ СОВМЕСТИМОСТЬ:
- Если p_account_id = NULL, функция работает как раньше (legacy режим)
- Если p_account_id передан, фильтрует метрики только по этому аккаунту
*/
