-- Migration 030: Expand creative_metrics_history for unified metrics system
-- Created: 2025-11-20
-- Description: Расширение таблицы для хранения метрик на уровне Ad (не AdSet)
--              Добавление полей для точного мэтчинга через ad_creative_mapping

-- =====================================================
-- ДОБАВЛЕНИЕ НОВЫХ ПОЛЕЙ
-- =====================================================

-- Добавляем ad_id для точного мэтчинга через ad_creative_mapping
ALTER TABLE creative_metrics_history 
  ADD COLUMN IF NOT EXISTS ad_id TEXT;

-- Добавляем недостающие метрики
ALTER TABLE creative_metrics_history 
  ADD COLUMN IF NOT EXISTS clicks INTEGER DEFAULT 0;

ALTER TABLE creative_metrics_history 
  ADD COLUMN IF NOT EXISTS link_clicks INTEGER DEFAULT 0;

ALTER TABLE creative_metrics_history 
  ADD COLUMN IF NOT EXISTS leads INTEGER DEFAULT 0;

ALTER TABLE creative_metrics_history 
  ADD COLUMN IF NOT EXISTS cpl DECIMAL(10,2);

-- =====================================================
-- ОБНОВЛЕНИЕ ИНДЕКСОВ
-- =====================================================

-- Добавляем индекс на ad_id для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_creative_metrics_ad_id 
  ON creative_metrics_history(ad_id) 
  WHERE ad_id IS NOT NULL;

-- Удаляем старый UNIQUE constraint на adset_id (теперь опциональный)
DROP INDEX IF EXISTS creative_metrics_adset_unique;

-- Добавляем новый UNIQUE constraint на ad_id + date
-- Это гарантирует что для каждого ad будет только одна запись в день
CREATE UNIQUE INDEX IF NOT EXISTS creative_metrics_ad_date_unique 
  ON creative_metrics_history(user_account_id, ad_id, date) 
  WHERE ad_id IS NOT NULL;

-- =====================================================
-- КОММЕНТАРИИ К НОВЫМ ПОЛЯМ
-- =====================================================

COMMENT ON COLUMN creative_metrics_history.ad_id IS 
  'Facebook Ad ID для точного мэтчинга через ad_creative_mapping. Используется для связи метрик с конкретным креативом.';

COMMENT ON COLUMN creative_metrics_history.clicks IS 
  'Общее количество кликов по объявлению';

COMMENT ON COLUMN creative_metrics_history.link_clicks IS 
  'Количество кликов по ссылке (извлекается из actions: action_type = link_click)';

COMMENT ON COLUMN creative_metrics_history.leads IS 
  'Количество лидов (извлекается из actions: lead, onsite_conversion.lead_grouped, messaging_conversation_started)';

COMMENT ON COLUMN creative_metrics_history.cpl IS 
  'Cost per lead в центах (вычисляемое: spend / leads * 100). NULL если leads = 0';

-- =====================================================
-- ОБНОВЛЕНИЕ ОПИСАНИЯ ТАБЛИЦЫ
-- =====================================================

COMMENT ON TABLE creative_metrics_history IS 
  'Унифицированное хранилище метрик креативов. Заполняется утром из agent-brain (на уровне Ad). 
  Используется в auto-launch, scoring, creative tests для избежания повторных запросов к Facebook API.
  Старые записи (с adset_id без ad_id) сохраняются для обратной совместимости.';

-- =====================================================
-- ПРИМЕЧАНИЯ
-- =====================================================

/*
НОВАЯ ЛОГИКА:

1. agent-brain утром:
   - Для каждого креатива находит все ads через ad_creative_mapping
   - Получает метрики для каждого ad из FB API (/{ad_id}/insights)
   - Сохраняет в creative_metrics_history с полями ad_id, creative_id
   
2. auto-launch и другие системы:
   - Читают метрики из creative_metrics_history (быстро, без FB API)
   - Если данных нет (новый креатив) → fallback на FB API
   
3. Агрегация:
   - Если у креатива несколько ads → суммируем impressions/spend/clicks/leads
   - Вычисляем средние CTR, CPM, CPL

ОБРАТНАЯ СОВМЕСТИМОСТЬ:
- Старые записи (adset_id без ad_id) не удаляются
- Новые записи заполняют оба поля: ad_id (primary) и adset_id (для истории)
*/

