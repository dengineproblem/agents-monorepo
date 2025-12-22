-- Таблица для хранения ежедневных отчетов по перепискам
CREATE TABLE IF NOT EXISTS conversation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Связь с пользователем
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  telegram_id TEXT,  -- Для отправки в Telegram

  -- Период отчета
  report_date DATE NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  -- Основные метрики
  total_dialogs INT DEFAULT 0,
  new_dialogs INT DEFAULT 0,
  active_dialogs INT DEFAULT 0,  -- Диалоги с активностью за период

  -- Конверсии по воронке
  conversions JSONB DEFAULT '{}'::jsonb,
  -- Структура: {
  --   "new_lead_to_qualified": 5,
  --   "qualified_to_consultation_booked": 3,
  --   "consultation_booked_to_completed": 2,
  --   "consultation_completed_to_deal_closed": 1,
  --   "deal_lost": 2
  -- }

  -- Распределение по интересам
  interest_distribution JSONB DEFAULT '{}'::jsonb,
  -- Структура: { "hot": 10, "warm": 25, "cold": 15 }

  -- Распределение по этапам воронки
  funnel_distribution JSONB DEFAULT '{}'::jsonb,
  -- Структура: {
  --   "new_lead": 10, "not_qualified": 5, "qualified": 8,
  --   "consultation_booked": 3, "consultation_completed": 2,
  --   "deal_closed": 1, "deal_lost": 2
  -- }

  -- Скорость ответов (в минутах)
  avg_response_time_minutes FLOAT,
  min_response_time_minutes FLOAT,
  max_response_time_minutes FLOAT,

  -- Количество сообщений
  total_incoming_messages INT DEFAULT 0,
  total_outgoing_messages INT DEFAULT 0,

  -- Инсайты от LLM
  insights JSONB DEFAULT '[]'::jsonb,
  -- Структура: [
  --   "Клиенты часто спрашивают о ценах",
  --   "Высокий интерес к услуге X",
  --   ...
  -- ]

  -- Причины отказов
  rejection_reasons JSONB DEFAULT '[]'::jsonb,
  -- Структура: [
  --   { "reason": "Высокая цена", "count": 5 },
  --   { "reason": "Долгие сроки", "count": 3 },
  --   ...
  -- ]

  -- Частые возражения
  common_objections JSONB DEFAULT '[]'::jsonb,
  -- Структура: [
  --   { "objection": "Дорого", "count": 8, "suggested_response": "..." },
  --   ...
  -- ]

  -- Рекомендации от LLM
  recommendations JSONB DEFAULT '[]'::jsonb,
  -- Структура: [
  --   "Улучшить скорость ответа в рабочие часы",
  --   "Добавить FAQ про цены",
  --   ...
  -- ]

  -- Полный текст отчета для Telegram
  report_text TEXT,

  -- Метаданные
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  sent_to_telegram BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Уникальность отчета на дату и пользователя
  UNIQUE(user_account_id, report_date)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_conversation_reports_user_account ON conversation_reports(user_account_id);
CREATE INDEX IF NOT EXISTS idx_conversation_reports_date ON conversation_reports(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_reports_telegram ON conversation_reports(telegram_id);
CREATE INDEX IF NOT EXISTS idx_conversation_reports_generated ON conversation_reports(generated_at DESC);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_conversation_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_conversation_reports_updated_at ON conversation_reports;
CREATE TRIGGER trigger_conversation_reports_updated_at
  BEFORE UPDATE ON conversation_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_reports_updated_at();

-- RLS политики
ALTER TABLE conversation_reports ENABLE ROW LEVEL SECURITY;

-- Сервисы могут читать отчеты (service_role обходит RLS)
CREATE POLICY conversation_reports_select_policy ON conversation_reports
  FOR SELECT USING (true);

-- Сервисы могут создавать/обновлять отчеты
CREATE POLICY conversation_reports_insert_policy ON conversation_reports
  FOR INSERT WITH CHECK (true);

CREATE POLICY conversation_reports_update_policy ON conversation_reports
  FOR UPDATE USING (true);

COMMENT ON TABLE conversation_reports IS 'Ежедневные отчеты по перепискам с аналитикой и рекомендациями от LLM';
