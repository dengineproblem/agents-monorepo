-- Migration 148: Add actions_taken and actions_failed to brain_executions
-- Date: 2025-01-11
-- Description: Добавляет колонки для учёта выполненных и неудачных действий Brain Mini
-- SAFE: Only adds nullable columns

ALTER TABLE brain_executions
ADD COLUMN IF NOT EXISTS actions_taken INTEGER DEFAULT 0;

ALTER TABLE brain_executions
ADD COLUMN IF NOT EXISTS actions_failed INTEGER DEFAULT 0;

COMMENT ON COLUMN brain_executions.actions_taken IS 'Количество выполненных действий при выполнении плана';
COMMENT ON COLUMN brain_executions.actions_failed IS 'Количество неудачных действий при выполнении плана';
