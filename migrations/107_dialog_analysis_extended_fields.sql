-- Миграция: Расширение полей dialog_analysis для улучшенного анализа переписок
-- Дата: 2024-12-23
-- Описание: Добавляет поля для отслеживания drop points, скрытых возражений и трендов интереса

-- =============================================
-- 1. Новые поля для dialog_analysis
-- =============================================

-- Последнее сообщение агента, на которое клиент НЕ ответил
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS last_unanswered_message TEXT;

COMMENT ON COLUMN dialog_analysis.last_unanswered_message IS 'Последнее сообщение агента без ответа клиента (drop point)';

-- На каком вопросе/этапе клиент "отвалился"
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS drop_point TEXT;

COMMENT ON COLUMN dialog_analysis.drop_point IS 'Описание момента где клиент перестал отвечать';

-- Скрытые возражения (массив)
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS hidden_objections JSONB DEFAULT '[]';

COMMENT ON COLUMN dialog_analysis.hidden_objections IS 'Массив скрытых возражений: односложные ответы, игнор вопросов, долгие паузы';

-- Тренд интереса
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS engagement_trend TEXT CHECK (engagement_trend IN ('falling', 'stable', 'rising'));

COMMENT ON COLUMN dialog_analysis.engagement_trend IS 'Тренд интереса клиента: falling (падает), stable (стабильный), rising (растёт)';

-- Явное возражение (отдельно от скрытых)
-- Уже есть поле objection, переименовывать не будем

-- =============================================
-- 2. Новые поля для conversation_reports (статистика отчётов)
-- =============================================

-- Источник трафика
ALTER TABLE conversation_reports
ADD COLUMN IF NOT EXISTS traffic_source JSONB DEFAULT '{}';

COMMENT ON COLUMN conversation_reports.traffic_source IS 'Статистика источников: {from_ads: N, smart_match: N, organic: N}';

-- Агрегированные drop points за день
ALTER TABLE conversation_reports
ADD COLUMN IF NOT EXISTS drop_points_summary JSONB DEFAULT '[]';

COMMENT ON COLUMN conversation_reports.drop_points_summary IS 'Топ drop points дня: [{point: "Вопрос о встрече", count: 5}, ...]';

-- Агрегированные скрытые возражения за день
ALTER TABLE conversation_reports
ADD COLUMN IF NOT EXISTS hidden_objections_summary JSONB DEFAULT '[]';

COMMENT ON COLUMN conversation_reports.hidden_objections_summary IS 'Топ скрытых возражений дня: [{type: "Односложные ответы", count: 8}, ...]';

-- Распределение трендов интереса
ALTER TABLE conversation_reports
ADD COLUMN IF NOT EXISTS engagement_trends JSONB DEFAULT '{}';

COMMENT ON COLUMN conversation_reports.engagement_trends IS 'Статистика трендов: {falling: N, stable: N, rising: N}';

-- =============================================
-- 3. Индексы для быстрого поиска
-- =============================================

-- Индекс для поиска по тренду
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_engagement_trend
ON dialog_analysis(engagement_trend)
WHERE engagement_trend IS NOT NULL;

-- Индекс для поиска диалогов с drop points
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_drop_point
ON dialog_analysis(drop_point)
WHERE drop_point IS NOT NULL;
