-- Migration 194: add template overrides to notification settings
-- Created: 2026-02-06
-- Description: Храним редактируемые тексты/каналы/периодичность уведомлений в singleton notification_settings

ALTER TABLE notification_settings
ADD COLUMN IF NOT EXISTS template_overrides JSONB DEFAULT '{}'::jsonb;

UPDATE notification_settings
SET template_overrides = '{}'::jsonb
WHERE template_overrides IS NULL;

COMMENT ON COLUMN notification_settings.template_overrides IS
  'JSON overrides by notification type: {"type": {"title","message","telegram_message","cta_url","cta_label","cooldown_days","channels"}}';
