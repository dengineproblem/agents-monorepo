-- Migration: Create text_generation_history table
-- Description: Stores history of text creative generations for context (last 5 for avoiding repetition)

CREATE TABLE IF NOT EXISTS text_generation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text_type TEXT NOT NULL CHECK (text_type IN ('storytelling', 'direct_offer', 'expert_video', 'telegram_post', 'threads_post')),
  user_prompt TEXT NOT NULL,
  generated_text TEXT NOT NULL,
  context_transcript_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick retrieval of recent generations by user
CREATE INDEX idx_text_gen_history_user_recent
  ON text_generation_history(user_id, created_at DESC);

-- Comment
COMMENT ON TABLE text_generation_history IS 'История генераций текстовых креативов. Хранит последние генерации для контекста LLM (избежание повторов).';
COMMENT ON COLUMN text_generation_history.text_type IS 'Тип текста: storytelling, direct_offer, expert_video, telegram_post, threads_post';
COMMENT ON COLUMN text_generation_history.context_transcript_ids IS 'UUID транскрибаций, использованных как контекст при генерации';
