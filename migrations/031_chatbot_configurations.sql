-- Миграция 031: Создание таблицы конфигурации чат-ботов
-- Дата: 2025-11-09
-- Описание: Таблица для хранения настроек AI чат-ботов

CREATE TABLE IF NOT EXISTS chatbot_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  bot_name TEXT DEFAULT 'AI Помощник',
  ai_instructions TEXT, -- Сгенерированный промпт для GPT
  user_instructions TEXT, -- Ручные правки владельца
  triggers JSONB DEFAULT '[]'::jsonb, -- Базовые триггеры: [{ keyword, response, moveToStage }]
  documents JSONB DEFAULT '[]'::jsonb, -- Загруженные документы: [{ name, url, type, size }]
  active BOOLEAN DEFAULT true, -- Бот активен/неактивен
  working_hours JSONB DEFAULT '{"start": "10:00", "end": "20:00", "days": [1,2,3,4,5]}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_chatbot_configs_user ON chatbot_configurations(user_account_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_configs_active ON chatbot_configurations(active);

-- Комментарии
COMMENT ON TABLE chatbot_configurations IS 'Конфигурация AI чат-ботов для пользователей';
COMMENT ON COLUMN chatbot_configurations.ai_instructions IS 'Промпт для GPT, сгенерированный из документов и анализа';
COMMENT ON COLUMN chatbot_configurations.user_instructions IS 'Ручные инструкции, добавленные пользователем';
COMMENT ON COLUMN chatbot_configurations.triggers IS 'Простые триггеры: keyword -> response';
COMMENT ON COLUMN chatbot_configurations.documents IS 'Метаданные загруженных документов (PDF, Excel, DOCX)';
COMMENT ON COLUMN chatbot_configurations.working_hours IS 'Расписание работы бота: время и дни недели';

-- RLS (Row Level Security)
ALTER TABLE chatbot_configurations ENABLE ROW LEVEL SECURITY;

-- Политика: пользователи видят только свои конфигурации
CREATE POLICY chatbot_configs_user_access ON chatbot_configurations
  FOR ALL
  USING (user_account_id = auth.uid());



