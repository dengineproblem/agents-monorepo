-- Миграция: Расширение dialog_analysis для semantic memory
-- Дата: 2025-12-13
-- Описание: Semantic Memory - поиск по истории диалогов через FTS и теги

-- Новые поля
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS summary TEXT,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS insights_json JSONB DEFAULT '{}';

-- FTS индекс для русского языка
CREATE INDEX IF NOT EXISTS dialog_analysis_summary_fts
ON dialog_analysis USING gin(to_tsvector('russian', COALESCE(summary, '')));

-- GIN индекс для массива tags
CREATE INDEX IF NOT EXISTS dialog_analysis_tags_idx
ON dialog_analysis USING gin(tags);

-- Комментарии
COMMENT ON COLUMN dialog_analysis.summary IS
'Краткое резюме диалога для поиска. Пример: "Клиент интересовался имплантацией, возражал по цене, просил рассрочку"';

COMMENT ON COLUMN dialog_analysis.tags IS
'Теги для фильтрации: услуга, тип возражения и т.д. Пример: ["имплантация", "возражение:цена", "рассрочка"]';

COMMENT ON COLUMN dialog_analysis.insights_json IS
'Структурированные инсайты. Пример: {"objections": ["дорого"], "interests": ["имплантация"], "next_action": "перезвонить через 3 дня"}';
