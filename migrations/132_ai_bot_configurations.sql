-- Migration: AI Bot Configurations for WhatsApp Bot Constructor
-- Description: Creates tables for AI bot settings and functions

-- ============================================
-- Table: ai_bot_configurations
-- Main bot configuration table
-- ============================================
CREATE TABLE IF NOT EXISTS ai_bot_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id),
  name TEXT NOT NULL DEFAULT 'Мой бот',
  is_active BOOLEAN DEFAULT true,

  -- AI settings
  system_prompt TEXT DEFAULT '',
  temperature NUMERIC(3,2) DEFAULT 0.24,
  model TEXT DEFAULT 'gpt-4o',

  -- Message history limits
  history_token_limit INTEGER DEFAULT 8000,
  history_message_limit INTEGER,          -- NULL = no limit
  history_time_limit_hours INTEGER,       -- NULL = no limit

  -- Message buffer (delay before response)
  message_buffer_seconds INTEGER DEFAULT 7,

  -- Operator control
  operator_pause_enabled BOOLEAN DEFAULT true,
  operator_pause_ignore_first_message BOOLEAN DEFAULT true,
  operator_auto_resume_hours INTEGER DEFAULT 0,
  operator_auto_resume_minutes INTEGER DEFAULT 0,
  operator_pause_exceptions TEXT[] DEFAULT '{}',

  -- Stop/Resume phrases
  stop_phrases TEXT[] DEFAULT '{}',
  resume_phrases TEXT[] DEFAULT '{}',

  -- Message splitting
  split_messages BOOLEAN DEFAULT false,
  split_max_length INTEGER DEFAULT 500,
  clean_markdown BOOLEAN DEFAULT true,

  -- Schedule
  schedule_enabled BOOLEAN DEFAULT false,
  schedule_hours_start INTEGER DEFAULT 9,
  schedule_hours_end INTEGER DEFAULT 18,
  schedule_days INTEGER[] DEFAULT '{1,2,3,4,5}',
  timezone TEXT DEFAULT 'Europe/Moscow',
  pass_current_datetime BOOLEAN DEFAULT true,

  -- Voice messages
  voice_recognition_enabled BOOLEAN DEFAULT false,
  voice_default_response TEXT,

  -- Images
  image_recognition_enabled BOOLEAN DEFAULT false,
  image_default_response TEXT,

  -- Documents
  document_recognition_enabled BOOLEAN DEFAULT false,
  document_default_response TEXT,

  -- Files
  file_handling_mode TEXT DEFAULT 'ignore',
  file_default_response TEXT,

  -- Messages
  start_message TEXT,
  error_message TEXT,

  -- Custom OpenAI API key
  custom_openai_api_key TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_ai_bot_configurations_user_account_id
  ON ai_bot_configurations(user_account_id);

-- ============================================
-- Table: ai_bot_functions
-- Bot callable functions
-- ============================================
CREATE TABLE IF NOT EXISTS ai_bot_functions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES ai_bot_configurations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  parameters JSONB DEFAULT '{}',
  handler_type TEXT NOT NULL,
  handler_config JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by bot
CREATE INDEX IF NOT EXISTS idx_ai_bot_functions_bot_id
  ON ai_bot_functions(bot_id);

-- ============================================
-- Alter: whatsapp_instances
-- Add ai_bot_id reference
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_instances' AND column_name = 'ai_bot_id'
  ) THEN
    ALTER TABLE whatsapp_instances
    ADD COLUMN ai_bot_id UUID REFERENCES ai_bot_configurations(id);
  END IF;
END $$;

-- Index for whatsapp_instances ai_bot lookup
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_ai_bot_id
  ON whatsapp_instances(ai_bot_id);

-- ============================================
-- Trigger: Update updated_at on ai_bot_configurations
-- ============================================
CREATE OR REPLACE FUNCTION update_ai_bot_configurations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ai_bot_configurations_updated_at ON ai_bot_configurations;
CREATE TRIGGER trigger_ai_bot_configurations_updated_at
  BEFORE UPDATE ON ai_bot_configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_bot_configurations_updated_at();

-- ============================================
-- RLS Policies (if RLS is enabled)
-- ============================================
ALTER TABLE ai_bot_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_bot_functions ENABLE ROW LEVEL SECURITY;

-- Policy for ai_bot_configurations
DROP POLICY IF EXISTS ai_bot_configurations_select_policy ON ai_bot_configurations;
CREATE POLICY ai_bot_configurations_select_policy ON ai_bot_configurations
  FOR ALL USING (true);

-- Policy for ai_bot_functions
DROP POLICY IF EXISTS ai_bot_functions_select_policy ON ai_bot_functions;
CREATE POLICY ai_bot_functions_select_policy ON ai_bot_functions
  FOR ALL USING (true);
