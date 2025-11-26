-- Миграция: Добавление детальных полей для брифа AI-таргетолог
-- Дата: 2025-11-22
-- Описание: Добавляем поля для более детальной генерации prompt4 (боли, обещания, социальные доказательства, гарантии, тон)

-- Добавляем новые поля в таблицу user_briefing_responses
ALTER TABLE user_briefing_responses
ADD COLUMN IF NOT EXISTS main_pains TEXT,
ADD COLUMN IF NOT EXISTS main_promises TEXT,
ADD COLUMN IF NOT EXISTS social_proof TEXT,
ADD COLUMN IF NOT EXISTS guarantees TEXT,
ADD COLUMN IF NOT EXISTS tone_of_voice TEXT;

-- Комментарии к новым полям
COMMENT ON COLUMN user_briefing_responses.main_pains IS 'Основные боли, страхи и сомнения целевой аудитории';
COMMENT ON COLUMN user_briefing_responses.main_promises IS 'Главные обещания и результаты для клиентов';
COMMENT ON COLUMN user_briefing_responses.social_proof IS 'Социальные доказательства (количество клиентов, кейсы, отзывы)';
COMMENT ON COLUMN user_briefing_responses.guarantees IS 'Гарантии (возврат денег, бесплатный период, пробное занятие и т.п.)';
COMMENT ON COLUMN user_briefing_responses.tone_of_voice IS 'Тон общения бренда (дружелюбный, экспертный, вдохновляющий и т.п.)';


