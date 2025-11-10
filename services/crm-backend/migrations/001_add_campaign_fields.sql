-- Migration: Add campaign-related fields to dialog_analysis and create campaign tables
-- Date: 2025-11-10
-- Description: MVP для автоматизации WhatsApp рассылок с AI

-- ===== 1. Расширение таблицы dialog_analysis =====

-- Поля для автопилота и рассылок
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN DEFAULT true;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS last_campaign_message_at TIMESTAMPTZ;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS campaign_messages_count INT DEFAULT 0;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS reactivation_score DECIMAL(5,2);

-- Поля для аудио/заметок
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS audio_transcripts JSONB DEFAULT '[]'::jsonb;
ALTER TABLE dialog_analysis ADD COLUMN IF NOT EXISTS manual_notes TEXT;

-- Индексы для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_autopilot ON dialog_analysis(autopilot_enabled) WHERE autopilot_enabled = true;
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_last_campaign ON dialog_analysis(last_campaign_message_at);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_reactivation_score ON dialog_analysis(reactivation_score DESC);

-- ===== 2. Таблица campaign_templates (шаблоны сообщений) =====

CREATE TABLE IF NOT EXISTS campaign_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('selling', 'useful', 'reminder')),
  is_active BOOLEAN DEFAULT true,
  usage_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_templates_user ON campaign_templates(user_account_id);
CREATE INDEX IF NOT EXISTS idx_campaign_templates_type ON campaign_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_campaign_templates_active ON campaign_templates(is_active) WHERE is_active = true;

-- ===== 3. Таблица campaign_messages (история отправок) =====

CREATE TABLE IF NOT EXISTS campaign_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES dialog_analysis(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('selling', 'useful', 'reminder')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'copied')) DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_messages_user ON campaign_messages(user_account_id);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_lead ON campaign_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_status ON campaign_messages(status);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_scheduled ON campaign_messages(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_created ON campaign_messages(created_at DESC);

-- ===== 4. Таблица campaign_settings (глобальные настройки) =====

CREATE TABLE IF NOT EXISTS campaign_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID UNIQUE NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  autopilot_enabled BOOLEAN DEFAULT false,
  daily_message_limit INT DEFAULT 300,
  hot_interval_days INT DEFAULT 2,
  warm_interval_days INT DEFAULT 5,
  cold_interval_days INT DEFAULT 10,
  work_hours_start INT DEFAULT 10,
  work_hours_end INT DEFAULT 20,
  work_days INT[] DEFAULT ARRAY[1,2,3,4,5], -- Пн-Пт (1=Monday, 5=Friday)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_settings_user ON campaign_settings(user_account_id);
CREATE INDEX IF NOT EXISTS idx_campaign_settings_autopilot ON campaign_settings(autopilot_enabled) WHERE autopilot_enabled = true;

-- ===== 5. Создать настройки по умолчанию для тестового пользователя =====

INSERT INTO campaign_settings (user_account_id, autopilot_enabled, daily_message_limit, hot_interval_days, warm_interval_days, cold_interval_days)
VALUES ('0f559eb0-53fa-4b6a-a51b-5d3e15e5864b', false, 300, 2, 5, 10)
ON CONFLICT (user_account_id) DO NOTHING;

-- ===== 6. Комментарии для документации =====

COMMENT ON TABLE campaign_templates IS 'Текстовые шаблоны для AI генерации персонализированных сообщений';
COMMENT ON TABLE campaign_messages IS 'История отправленных/запланированных сообщений кампаний реактивации';
COMMENT ON TABLE campaign_settings IS 'Глобальные настройки кампаний для каждого пользователя';

COMMENT ON COLUMN dialog_analysis.autopilot_enabled IS 'Включен ли автопилот для этого лида (можно исключить отдельных лидов)';
COMMENT ON COLUMN dialog_analysis.last_campaign_message_at IS 'Время последнего отправленного сообщения кампании';
COMMENT ON COLUMN dialog_analysis.campaign_messages_count IS 'Количество отправленных сообщений кампаний';
COMMENT ON COLUMN dialog_analysis.reactivation_score IS 'Расширенный score для приоритизации в очереди рассылки';
COMMENT ON COLUMN dialog_analysis.audio_transcripts IS 'Массив транскриптов аудиозаписей звонков (JSON)';
COMMENT ON COLUMN dialog_analysis.manual_notes IS 'Текстовые заметки менеджера о лиде';

