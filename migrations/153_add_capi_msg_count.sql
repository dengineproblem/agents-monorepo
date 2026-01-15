-- Migration 153: Add CAPI message counter to dialog_analysis
-- Description: Separate counter for CAPI Interest events (does not affect incoming_count)
-- Date: 2026-01-15

-- Отдельный счётчик сообщений для CAPI (не путать с incoming_count!)
-- Считает только входящие сообщения от рекламных лидов (с source_id)
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS capi_msg_count INT NOT NULL DEFAULT 0;

-- Флаг отправки Interest (ViewContent) события
-- Сбрасывается при повторном клике на рекламу
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS capi_interest_sent BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN dialog_analysis.capi_msg_count IS
  'Счётчик сообщений для CAPI - считает только входящие сообщения от рекламных лидов';

COMMENT ON COLUMN dialog_analysis.capi_interest_sent IS
  'Флаг отправки CAPI Interest (ViewContent) события - сбрасывается при повторном клике на рекламу';

-- Индекс для быстрого поиска лидов, достигших порога
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_capi_msg_count
ON dialog_analysis(capi_msg_count)
WHERE capi_msg_count >= 3 AND NOT capi_interest_sent;
