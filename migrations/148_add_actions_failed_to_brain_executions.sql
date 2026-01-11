-- Migration 148: Add actions_failed to brain_executions
-- Date: 2025-01-11
-- Description: Добавляет колонку actions_failed для учёта неудачных действий при выполнении Brain Mini
-- SAFE: Only adds nullable column

ALTER TABLE brain_executions
ADD COLUMN IF NOT EXISTS actions_failed INTEGER DEFAULT 0;

COMMENT ON COLUMN brain_executions.actions_failed IS 'Количество неудачных действий при выполнении плана';
