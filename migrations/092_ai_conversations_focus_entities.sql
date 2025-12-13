-- Миграция: Добавление focus_entities в ai_conversations
-- Дата: 2025-12-13
-- Описание: Session Memory - хранение контекста текущего диалога (campaignId, directionId, dialogPhone, period)

ALTER TABLE ai_conversations
ADD COLUMN IF NOT EXISTS focus_entities JSONB DEFAULT '{}';

COMMENT ON COLUMN ai_conversations.focus_entities IS
'Контекст текущего диалога: campaignId, directionId, dialogPhone, period';
