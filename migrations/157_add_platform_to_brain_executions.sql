-- Migration 157: Add platform column to brain_executions
-- Date: 2025-01-16
-- Description: Добавляет колонку platform для поддержки TikTok
-- SAFE: Only adds nullable column

ALTER TABLE brain_executions
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'facebook';

-- Index for platform filtering
CREATE INDEX IF NOT EXISTS idx_brain_executions_platform
  ON brain_executions(platform);

COMMENT ON COLUMN brain_executions.platform IS 'Platform: facebook or tiktok';
