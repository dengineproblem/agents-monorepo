-- Migration: Add video engagement metrics to creative_metrics_history
-- Created: 2025-11-20
-- Purpose: Добавить метрики по глубине просмотра видео для комплексного анализа креативов

-- =====================================================
-- 1. ADD VIDEO METRICS COLUMNS
-- =====================================================

ALTER TABLE creative_metrics_history
ADD COLUMN IF NOT EXISTS video_views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS video_views_25_percent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS video_views_50_percent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS video_views_75_percent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS video_views_95_percent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS video_avg_watch_time_sec NUMERIC(10,2);

-- =====================================================
-- 2. ADD COMMENTS
-- =====================================================

COMMENT ON COLUMN creative_metrics_history.video_views IS 
'Общее количество просмотров видео (video_play_actions из FB API)';

COMMENT ON COLUMN creative_metrics_history.video_views_25_percent IS 
'Количество просмотров до 25% длительности видео (video_p25_watched_actions)';

COMMENT ON COLUMN creative_metrics_history.video_views_50_percent IS 
'Количество просмотров до 50% длительности видео (video_p50_watched_actions)';

COMMENT ON COLUMN creative_metrics_history.video_views_75_percent IS 
'Количество просмотров до 75% длительности видео (video_p75_watched_actions)';

COMMENT ON COLUMN creative_metrics_history.video_views_95_percent IS 
'Количество просмотров до 95% длительности видео (video_p95_watched_actions)';

COMMENT ON COLUMN creative_metrics_history.video_avg_watch_time_sec IS 
'Среднее время просмотра видео в секундах (video_avg_time_watched_actions)';

-- =====================================================
-- 3. ADD INDEX FOR VIDEO ANALYTICS
-- =====================================================

-- Индекс для анализа видео-метрик по креативам
CREATE INDEX IF NOT EXISTS idx_creative_metrics_history_video_engagement 
ON creative_metrics_history(user_account_id, creative_id, date DESC) 
WHERE video_views > 0;

-- =====================================================
-- USAGE EXAMPLES
-- =====================================================

-- Пример 1: Получить engagement rate по видео
-- SELECT 
--   creative_id,
--   date,
--   video_views,
--   video_views_50_percent,
--   ROUND((video_views_50_percent::NUMERIC / NULLIF(video_views, 0)) * 100, 2) as engagement_50_percent,
--   video_avg_watch_time_sec
-- FROM creative_metrics_history
-- WHERE user_account_id = 'xxx' AND video_views > 0
-- ORDER BY date DESC;

-- Пример 2: Сравнить video engagement test vs production
-- SELECT 
--   source,
--   AVG(video_views_50_percent::NUMERIC / NULLIF(video_views, 0) * 100) as avg_engagement_50,
--   AVG(video_views_75_percent::NUMERIC / NULLIF(video_views, 0) * 100) as avg_engagement_75
-- FROM creative_metrics_history
-- WHERE creative_id = 'xxx' AND video_views > 0
-- GROUP BY source;

