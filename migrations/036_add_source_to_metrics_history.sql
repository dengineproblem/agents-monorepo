-- Migration 036: Add source field to creative_metrics_history
-- Created: 2025-11-21
-- Description: Добавление поля source для разделения test/production метрик

-- =====================================================
-- ДОБАВЛЕНИЕ ПОЛЯ SOURCE
-- =====================================================

-- Добавляем поле source для разделения test/production метрик
ALTER TABLE creative_metrics_history 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'production' 
  CHECK (source IN ('production', 'test'));

-- Обновляем существующие записи без source
UPDATE creative_metrics_history 
SET source = 'production' 
WHERE source IS NULL;

-- Индекс для быстрой фильтрации по source
CREATE INDEX IF NOT EXISTS idx_creative_metrics_source 
  ON creative_metrics_history(source) 
  WHERE source IS NOT NULL;

-- =====================================================
-- КОММЕНТАРИИ
-- =====================================================

COMMENT ON COLUMN creative_metrics_history.source IS 
  'Источник метрик: production (ежедневный сбор agent-brain) или test (creative tests)';

-- =====================================================
-- ПРИМЕЧАНИЯ
-- =====================================================

/*
НАЗНАЧЕНИЕ:
- Разделение тестовых и production метрик в одной таблице
- Production метрики собираются agent-brain каждое утро (инкрементально по дням)
- Test метрики сохраняются из creative tests (краткосрочные)

ИСПОЛЬЗОВАНИЕ:
- При запросах всегда фильтровать по source = 'production' или 'test'
- При сохранении указывать соответствующий source
*/

