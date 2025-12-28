-- Migration: Create AI Bot Configurations table for WhatsApp bot constructor
-- Date: 2025-12-24
-- Description: Таблица для хранения настроек AI-ботов WhatsApp

-- ===== 1. Таблица ai_bot_configurations (настройки AI бота) =====

CREATE TABLE IF NOT EXISTS ai_bot_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Основные настройки
  name TEXT NOT NULL DEFAULT 'Мой бот',
  is_active BOOLEAN DEFAULT true,

  -- Инструкция для AI
  system_prompt TEXT NOT NULL DEFAULT '',
  temperature DECIMAL(3,2) DEFAULT 0.24 CHECK (temperature >= 0 AND temperature <= 1),

  -- Выбор модели
  model TEXT DEFAULT 'gpt-4o' CHECK (model IN (
    'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'gpt-4o', 'gpt-4o-mini', 'gpt-o3'
  )),

  -- Оптимизация истории диалога
  history_token_limit INT DEFAULT 10000 CHECK (history_token_limit >= 0 AND history_token_limit <= 128000),
  history_message_limit INT CHECK (history_message_limit IS NULL OR (history_message_limit >= 1 AND history_message_limit <= 100)),
  history_time_limit_hours INT CHECK (history_time_limit_hours IS NULL OR (history_time_limit_hours >= 1 AND history_time_limit_hours <= 168)),

  -- Контроль вмешательства оператора
  operator_pause_enabled BOOLEAN DEFAULT true,
  operator_pause_ignore_first_message BOOLEAN DEFAULT false,
  operator_auto_resume_hours INT DEFAULT 1 CHECK (operator_auto_resume_hours >= 0 AND operator_auto_resume_hours <= 72),
  operator_auto_resume_minutes INT DEFAULT 0 CHECK (operator_auto_resume_minutes >= 0 AND operator_auto_resume_minutes <= 59),
  operator_pause_exceptions TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Управление диалогом по ключевым фразам
  stop_phrases TEXT[] DEFAULT ARRAY[]::TEXT[],
  resume_phrases TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Буфер сообщений
  message_buffer_seconds INT DEFAULT 7 CHECK (message_buffer_seconds >= 1 AND message_buffer_seconds <= 60),

  -- Деление сообщений
  split_messages BOOLEAN DEFAULT false,
  split_max_length INT DEFAULT 500 CHECK (split_max_length >= 100 AND split_max_length <= 2000),

  -- Лимиты расходов
  daily_cost_limit_cents INT CHECK (daily_cost_limit_cents IS NULL OR daily_cost_limit_cents >= 0),
  user_cost_limit_cents INT CHECK (user_cost_limit_cents IS NULL OR user_cost_limit_cents >= 0),

  -- Форматирование текста
  adaptive_formatting BOOLEAN DEFAULT false,
  clean_markdown BOOLEAN DEFAULT true,

  -- Дата и время
  pass_current_datetime BOOLEAN DEFAULT true,
  timezone TEXT DEFAULT 'Asia/Yekaterinburg',

  -- Расписание работы агента
  schedule_enabled BOOLEAN DEFAULT false,
  schedule_hours_start INT DEFAULT 9 CHECK (schedule_hours_start >= 0 AND schedule_hours_start <= 23),
  schedule_hours_end INT DEFAULT 19 CHECK (schedule_hours_end >= 0 AND schedule_hours_end <= 23),
  schedule_days INT[] DEFAULT ARRAY[1,2,3,4,5,6,7],

  -- Голосовые сообщения
  voice_recognition_enabled BOOLEAN DEFAULT true,
  voice_recognition_model TEXT DEFAULT 'whisper',
  voice_response_mode TEXT DEFAULT 'never' CHECK (voice_response_mode IN ('never', 'on_voice', 'always')),
  voice_default_response TEXT DEFAULT 'К сожалению, я не могу обрабатывать голосовые сообщения. Пожалуйста, напишите текстом.',

  -- Изображения
  image_recognition_enabled BOOLEAN DEFAULT true,
  image_default_response TEXT DEFAULT 'К сожалению, я не могу обрабатывать изображения. Пожалуйста, опишите ваш вопрос текстом.',
  image_send_from_links BOOLEAN DEFAULT false,

  -- Документы
  document_recognition_enabled BOOLEAN DEFAULT false,
  document_default_response TEXT DEFAULT 'К сожалению, я не могу обрабатывать документы. Пожалуйста, опишите ваш вопрос текстом, и я с удовольствием помогу!',
  document_send_from_links BOOLEAN DEFAULT false,

  -- Файлы
  file_handling_mode TEXT DEFAULT 'ignore' CHECK (file_handling_mode IN ('ignore', 'respond')),
  file_default_response TEXT DEFAULT 'К сожалению, я не могу обрабатывать этот тип файлов.',

  -- Отложенная отправка
  delayed_messages JSONB DEFAULT '[]'::jsonb,
  delayed_schedule_enabled BOOLEAN DEFAULT false,
  delayed_schedule_hours_start INT DEFAULT 9,
  delayed_schedule_hours_end INT DEFAULT 19,

  -- Сообщения
  start_message TEXT DEFAULT '',
  error_message TEXT DEFAULT 'Извините, сервис временно не доступен, напишите свой номер телефона, я передам менеджеру.',

  -- Свой API ключ
  custom_openai_api_key TEXT,

  -- Метаданные
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_ai_bot_configurations_user ON ai_bot_configurations(user_account_id);
CREATE INDEX IF NOT EXISTS idx_ai_bot_configurations_active ON ai_bot_configurations(is_active) WHERE is_active = true;

-- Уникальный индекс - один активный бот на пользователя (опционально можно убрать для мультибот режима)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_bot_configurations_user_active
--   ON ai_bot_configurations(user_account_id) WHERE is_active = true;

-- ===== 2. Таблица ai_bot_functions (функции бота) =====

CREATE TABLE IF NOT EXISTS ai_bot_functions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES ai_bot_configurations(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT NOT NULL,
  parameters JSONB DEFAULT '{}'::jsonb,
  handler_type TEXT NOT NULL CHECK (handler_type IN ('webhook', 'internal', 'forward_to_manager')),
  handler_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_bot_functions_bot ON ai_bot_functions(bot_id);
CREATE INDEX IF NOT EXISTS idx_ai_bot_functions_active ON ai_bot_functions(is_active) WHERE is_active = true;

-- ===== 3. Комментарии для документации =====

COMMENT ON TABLE ai_bot_configurations IS 'Полные настройки AI-бота для WhatsApp, включая модель, промпт, голос, изображения и т.д.';
COMMENT ON TABLE ai_bot_functions IS 'Функции (tools) которые AI бот может вызывать';

COMMENT ON COLUMN ai_bot_configurations.temperature IS 'Температура модели от 0 до 1 (0.24 = 24%)';
COMMENT ON COLUMN ai_bot_configurations.history_token_limit IS 'Лимит токенов в контексте диалога';
COMMENT ON COLUMN ai_bot_configurations.history_message_limit IS 'Лимит количества сообщений в контексте';
COMMENT ON COLUMN ai_bot_configurations.history_time_limit_hours IS 'Лимит времени сообщений в часах';
COMMENT ON COLUMN ai_bot_configurations.operator_pause_enabled IS 'Пауза бота при вмешательстве оператора';
COMMENT ON COLUMN ai_bot_configurations.operator_pause_exceptions IS 'Фразы-исключения, не вызывающие паузу';
COMMENT ON COLUMN ai_bot_configurations.stop_phrases IS 'Фразы для остановки бота';
COMMENT ON COLUMN ai_bot_configurations.resume_phrases IS 'Фразы для возобновления работы бота';
COMMENT ON COLUMN ai_bot_configurations.message_buffer_seconds IS 'Время ожидания перед ответом (склейка сообщений)';
COMMENT ON COLUMN ai_bot_configurations.delayed_messages IS 'JSON массив отложенных сообщений [{hours, minutes, prompt, repeat_count, off_hours_behavior, off_hours_time}]';
COMMENT ON COLUMN ai_bot_configurations.custom_openai_api_key IS 'Свой API ключ OpenAI (шифруется)';

-- ===== 4. Добавить привязку бота к WhatsApp инстансу =====

ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS ai_bot_id UUID REFERENCES ai_bot_configurations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_ai_bot ON whatsapp_instances(ai_bot_id);

COMMENT ON COLUMN whatsapp_instances.ai_bot_id IS 'Привязанный AI бот для автоматических ответов';
