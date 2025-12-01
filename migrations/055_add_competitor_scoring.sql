-- Миграция: Добавление скоринга для креативов конкурентов
-- Дата: 2025-12-01
-- Описание: Поля для скоринга ТОП-10 креативов с накоплением до 50 на конкурента

-- =====================================================
-- ЧАСТЬ 1: Новые поля в competitor_creatives
-- =====================================================

-- Длительность показа в днях (рассчитывается от first_shown_date)
ALTER TABLE competitor_creatives
ADD COLUMN IF NOT EXISTS duration_days INTEGER;

-- Количество вариаций креатива (из SearchAPI)
ALTER TABLE competitor_creatives
ADD COLUMN IF NOT EXISTS ad_variations INTEGER DEFAULT 1;

-- Score креатива (0-100 баллов)
ALTER TABLE competitor_creatives
ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0;

-- Флаг: входит ли в текущий ТОП-10
ALTER TABLE competitor_creatives
ADD COLUMN IF NOT EXISTS is_top10 BOOLEAN DEFAULT false;

-- Когда впервые вошёл в ТОП-10 (для бейджа "Новый")
ALTER TABLE competitor_creatives
ADD COLUMN IF NOT EXISTS entered_top10_at TIMESTAMPTZ;

-- Последний раз видели в SearchAPI
ALTER TABLE competitor_creatives
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();

-- =====================================================
-- ЧАСТЬ 2: Индексы для производительности
-- =====================================================

-- Индекс для быстрого получения ТОП-10 по конкуренту
CREATE INDEX IF NOT EXISTS idx_creatives_top10_score
ON competitor_creatives(competitor_id, score DESC)
WHERE is_top10 = true;

-- Индекс для сортировки всех креативов по score
CREATE INDEX IF NOT EXISTS idx_creatives_competitor_score
ON competitor_creatives(competitor_id, score DESC);

-- Индекс для pending OCR задач
CREATE INDEX IF NOT EXISTS idx_analysis_pending_status
ON competitor_creative_analysis(processing_status)
WHERE processing_status = 'pending';

-- Индекс для очистки старых креативов (лимит 50)
CREATE INDEX IF NOT EXISTS idx_creatives_competitor_created
ON competitor_creatives(competitor_id, created_at ASC);

-- =====================================================
-- КОММЕНТАРИИ
-- =====================================================

COMMENT ON COLUMN competitor_creatives.duration_days IS 'Количество дней с момента первого показа (first_shown_date)';
COMMENT ON COLUMN competitor_creatives.ad_variations IS 'Количество вариаций креатива (карточки карусели + видео + изображения)';
COMMENT ON COLUMN competitor_creatives.score IS 'Score креатива 0-100: active(25) + duration(25) + variations(25) + format(25)';
COMMENT ON COLUMN competitor_creatives.is_top10 IS 'Входит ли креатив в текущий ТОП-10 по score';
COMMENT ON COLUMN competitor_creatives.entered_top10_at IS 'Дата первого попадания в ТОП-10 (для бейджа "Новый" если <7 дней)';
COMMENT ON COLUMN competitor_creatives.last_seen_at IS 'Когда креатив последний раз был найден в SearchAPI';
