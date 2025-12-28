-- Migration: Add consultation integration to AI Bot
-- Date: 2025-12-28
-- Description: Добавляет поля для интеграции AI-бота с системой консультаций

-- ===== 1. Добавить поля интеграции в ai_bot_configurations =====

ALTER TABLE ai_bot_configurations ADD COLUMN IF NOT EXISTS
  consultation_integration_enabled BOOLEAN DEFAULT false;

ALTER TABLE ai_bot_configurations ADD COLUMN IF NOT EXISTS
  consultation_settings JSONB DEFAULT '{
    "consultant_ids": [],
    "slots_to_show": 5,
    "default_duration_minutes": 60,
    "days_ahead_limit": 14,
    "auto_summarize_dialog": true,
    "collect_client_name": true
  }'::jsonb;

-- ===== 2. Комментарии =====

COMMENT ON COLUMN ai_bot_configurations.consultation_integration_enabled IS 'Включена ли интеграция бота с системой консультаций';
COMMENT ON COLUMN ai_bot_configurations.consultation_settings IS 'Настройки интеграции: consultant_ids (пустой = все), slots_to_show, default_duration_minutes, days_ahead_limit, auto_summarize_dialog, collect_client_name';

-- ===== 3. Индекс для поиска ботов с включенной интеграцией =====

CREATE INDEX IF NOT EXISTS idx_ai_bot_configurations_consultation_enabled
  ON ai_bot_configurations(consultation_integration_enabled)
  WHERE consultation_integration_enabled = true;
