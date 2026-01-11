-- Migration 146: Add execution_hour to batch_execution_results
-- Позволяет различать hourly запуски в рамках одного дня

-- Добавить час выполнения
ALTER TABLE batch_execution_results
ADD COLUMN IF NOT EXISTS execution_hour INTEGER CHECK (execution_hour >= 0 AND execution_hour <= 23);

-- Обновить индекс для поддержки hourly запросов
DROP INDEX IF EXISTS idx_batch_execution_date;
CREATE INDEX IF NOT EXISTS idx_batch_execution_datetime
ON batch_execution_results(execution_date DESC, execution_hour DESC);

COMMENT ON COLUMN batch_execution_results.execution_hour IS 'Час выполнения батча (0-23) для различения hourly запусков';
