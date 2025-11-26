-- Migration: Add unique constraint to creative_analysis
-- Created: 2025-11-21
-- Purpose: Позволить использовать upsert для обновления анализов

-- Сначала удалить дубликаты (если есть) - оставляем только последние
DELETE FROM creative_analysis a
USING creative_analysis b
WHERE a.id < b.id
  AND a.creative_id = b.creative_id
  AND a.user_account_id = b.user_account_id
  AND a.source = b.source;

-- Добавляем unique constraint
ALTER TABLE creative_analysis
ADD CONSTRAINT creative_analysis_unique_per_source
UNIQUE (creative_id, user_account_id, source);

COMMENT ON CONSTRAINT creative_analysis_unique_per_source ON creative_analysis IS
'Гарантирует что для каждого креатива есть только один актуальный анализ из каждого источника (test/manual/scheduled)';


