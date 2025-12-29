-- Migration: Delayed Follow-ups (Отложенные сообщения)
-- Description: Таблица очереди отложенных follow-up сообщений для AI-ботов

-- ============================================
-- Table: delayed_follow_ups
-- Очередь отложенных follow-up сообщений
-- ============================================
CREATE TABLE IF NOT EXISTS delayed_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES ai_bot_configurations(id) ON DELETE CASCADE,
  dialog_analysis_id UUID NOT NULL REFERENCES dialog_analysis(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  step_index INT NOT NULL DEFAULT 0,  -- 0, 1, 2 (какой follow-up в цепочке)
  prompt TEXT NOT NULL,                -- mini prompt для генерации
  scheduled_at TIMESTAMPTZ NOT NULL,   -- когда отправить
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  sent_at TIMESTAMPTZ,                 -- когда фактически отправлено
  error_message TEXT,                  -- если failed
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Только один pending follow-up на каждом шаге для диалога
  -- Старые cancelled/sent/failed записи не блокируют создание новых
  retry_count INT NOT NULL DEFAULT 0
);

-- ============================================
-- Indexes
-- ============================================

-- Индекс для worker'а: pending записи по времени
CREATE INDEX IF NOT EXISTS idx_delayed_follow_ups_pending_scheduled
  ON delayed_follow_ups(scheduled_at)
  WHERE status = 'pending';

-- Индекс для отмены follow-ups при входящем сообщении
CREATE INDEX IF NOT EXISTS idx_delayed_follow_ups_dialog_pending
  ON delayed_follow_ups(dialog_analysis_id)
  WHERE status = 'pending';

-- Индекс для поиска по боту
CREATE INDEX IF NOT EXISTS idx_delayed_follow_ups_bot_id
  ON delayed_follow_ups(bot_id);

-- Уникальный индекс: только один pending на каждом шаге для диалога
CREATE UNIQUE INDEX IF NOT EXISTS idx_delayed_follow_ups_pending_unique
  ON delayed_follow_ups(dialog_analysis_id, step_index)
  WHERE status = 'pending';

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE delayed_follow_ups IS 'Очередь отложенных follow-up сообщений для AI-ботов';
COMMENT ON COLUMN delayed_follow_ups.step_index IS 'Номер шага в цепочке (0, 1, 2)';
COMMENT ON COLUMN delayed_follow_ups.prompt IS 'Mini prompt для генерации follow-up через LLM';
COMMENT ON COLUMN delayed_follow_ups.scheduled_at IS 'Запланированное время отправки';
COMMENT ON COLUMN delayed_follow_ups.status IS 'pending=ожидает, sent=отправлено, cancelled=отменено, failed=ошибка';
COMMENT ON COLUMN delayed_follow_ups.retry_count IS 'Счётчик повторных попыток (макс 3)';
