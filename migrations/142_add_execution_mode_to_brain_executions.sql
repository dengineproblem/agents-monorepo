-- Migration 142: Add execution_mode to brain_executions
-- Date: 2025-01-09
-- Description: Добавляет execution_mode для различения режимов запуска Brain (batch, manual_trigger, etc.)
-- SAFE: Only adds nullable column

ALTER TABLE brain_executions
ADD COLUMN IF NOT EXISTS execution_mode TEXT;

COMMENT ON COLUMN brain_executions.execution_mode IS 'Режим запуска: batch (автопилот 8:00), manual_trigger (Brain Mini), interactive (чат)';

-- Опционально: установить значение по умолчанию для существующих записей
-- UPDATE brain_executions SET execution_mode = 'batch' WHERE execution_mode IS NULL;
