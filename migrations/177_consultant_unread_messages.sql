-- Migration 177: Add consultant unread messages tracking
-- Description: Add fields to track unread messages for consultants

-- Добавить поля для отслеживания непрочитанных сообщений
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS has_unread BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_consultant_message_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_client_message_at TIMESTAMPTZ;

-- Индекс для быстрой выборки лидов с непрочитанными
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_has_unread
ON dialog_analysis(assigned_consultant_id, has_unread)
WHERE has_unread = true;

-- Комментарии
COMMENT ON COLUMN dialog_analysis.has_unread IS 'Флаг наличия непрочитанных сообщений от клиента после ответа консультанта';
COMMENT ON COLUMN dialog_analysis.last_consultant_message_at IS 'Время последнего сообщения консультанта лиду';
COMMENT ON COLUMN dialog_analysis.last_client_message_at IS 'Время последнего сообщения клиента';
