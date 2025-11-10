-- Миграция 030: Добавление полей для управления чат-ботом
-- Дата: 2025-11-09
-- Описание: Добавляет поля для управления ботом в dialog_analysis

-- Добавить поля управления ботом в dialog_analysis
ALTER TABLE dialog_analysis 
  ADD COLUMN IF NOT EXISTS assigned_to_human BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bot_paused BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bot_paused_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_bot_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reactivation_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reactivation_at TIMESTAMPTZ;

-- Создать индексы для производительности
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_assigned ON dialog_analysis(assigned_to_human);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_bot_paused ON dialog_analysis(bot_paused);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_reactivation 
  ON dialog_analysis(last_bot_message_at, interest_level, funnel_stage);

-- Комментарии к полям
COMMENT ON COLUMN dialog_analysis.assigned_to_human IS 'Лид взят в работу менеджером (бот останавливается)';
COMMENT ON COLUMN dialog_analysis.bot_paused IS 'Бот на паузе для этого лида';
COMMENT ON COLUMN dialog_analysis.bot_paused_until IS 'Бот на паузе до указанного времени';
COMMENT ON COLUMN dialog_analysis.last_bot_message_at IS 'Время последнего сообщения от бота';
COMMENT ON COLUMN dialog_analysis.follow_up_scheduled_at IS 'Запланированное догоняющее сообщение';
COMMENT ON COLUMN dialog_analysis.reactivation_attempts IS 'Количество попыток реанимации';
COMMENT ON COLUMN dialog_analysis.last_reactivation_at IS 'Время последней попытки реанимации';


