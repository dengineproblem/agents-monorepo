-- =============================================
-- Миграция 221: Добавить настройку остановки follow-up при записи на консультацию
-- Описание: Позволяет отключать follow-up сообщения для лидов, записавшихся на консультацию
-- Дата: 2026-02-19
-- =============================================

ALTER TABLE ai_bot_configurations
  ADD COLUMN IF NOT EXISTS delayed_stop_on_consultation BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN ai_bot_configurations.delayed_stop_on_consultation
  IS 'Отменять follow-up сообщения если клиент записался на консультацию (default: true)';
