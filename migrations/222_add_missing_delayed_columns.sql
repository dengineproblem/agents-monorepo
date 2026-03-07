-- =============================================
-- Миграция 222: Добавить недостающие колонки для отложенных follow-up сообщений
-- Описание: Колонки delayed_messages, delayed_schedule_enabled, delayed_schedule_hours_start,
--           delayed_schedule_hours_end были в CREATE TABLE миграции 010, но не были применены на продакшене
-- Дата: 2026-02-19
-- =============================================

ALTER TABLE ai_bot_configurations
  ADD COLUMN IF NOT EXISTS delayed_messages JSONB DEFAULT '[]'::jsonb;

ALTER TABLE ai_bot_configurations
  ADD COLUMN IF NOT EXISTS delayed_schedule_enabled BOOLEAN DEFAULT false;

ALTER TABLE ai_bot_configurations
  ADD COLUMN IF NOT EXISTS delayed_schedule_hours_start INT DEFAULT 9;

ALTER TABLE ai_bot_configurations
  ADD COLUMN IF NOT EXISTS delayed_schedule_hours_end INT DEFAULT 19;

COMMENT ON COLUMN ai_bot_configurations.delayed_messages
  IS 'JSON массив отложенных сообщений [{hours, minutes, prompt, repeat_count, off_hours_behavior, off_hours_time}]';

COMMENT ON COLUMN ai_bot_configurations.delayed_schedule_enabled
  IS 'Включены ли отложенные follow-up сообщения';

COMMENT ON COLUMN ai_bot_configurations.delayed_schedule_hours_start
  IS 'Час начала рабочего времени для отправки follow-up (default: 9)';

COMMENT ON COLUMN ai_bot_configurations.delayed_schedule_hours_end
  IS 'Час окончания рабочего времени для отправки follow-up (default: 19)';

-- Обновить кеш схемы PostgREST
NOTIFY pgrst, 'reload schema';
