-- Migration 061: Add competitor_instagrams to user_briefing_responses
-- Позволяет хранить до 5 Instagram аккаунтов конкурентов, указанных при онбординге
-- SAFE: Only adds nullable column with default

-- 1. Add competitor_instagrams column (JSONB array)
ALTER TABLE user_briefing_responses
ADD COLUMN competitor_instagrams JSONB DEFAULT '[]'::jsonb;

-- 2. Add check constraint for max 5 competitors
ALTER TABLE user_briefing_responses
ADD CONSTRAINT check_max_5_competitors
CHECK (jsonb_array_length(COALESCE(competitor_instagrams, '[]'::jsonb)) <= 5);

COMMENT ON COLUMN user_briefing_responses.competitor_instagrams IS
  'Instagram аккаунты конкурентов (до 5). Формат: ["username1", "username2", ...]';
