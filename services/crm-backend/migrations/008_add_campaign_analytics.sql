-- Migration: Add campaign analytics fields and lead snapshots
-- Date: 2025-11-17
-- Description: Расширение системы рассылок для отслеживания аналитики без использования LLM

-- ===== 1. Расширение таблицы campaign_messages =====

-- Добавляем поля для аналитики на момент отправки
ALTER TABLE campaign_messages 
  ADD COLUMN IF NOT EXISTS interest_level_at_send TEXT CHECK (interest_level_at_send IN ('hot', 'warm', 'cold')),
  ADD COLUMN IF NOT EXISTS funnel_stage_at_send TEXT,
  ADD COLUMN IF NOT EXISTS score_at_send INTEGER;

-- Добавляем поля для отслеживания ответов
ALTER TABLE campaign_messages
  ADD COLUMN IF NOT EXISTS has_reply BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_reply_at TIMESTAMPTZ;

-- Добавляем поля для отслеживания целевых действий
ALTER TABLE campaign_messages
  ADD COLUMN IF NOT EXISTS led_to_target_action BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_action_type TEXT,
  ADD COLUMN IF NOT EXISTS target_action_at TIMESTAMPTZ;

-- Комментарии для документации
COMMENT ON COLUMN campaign_messages.interest_level_at_send IS 'Температура лида на момент отправки (hot/warm/cold)';
COMMENT ON COLUMN campaign_messages.funnel_stage_at_send IS 'Этап воронки на момент отправки';
COMMENT ON COLUMN campaign_messages.score_at_send IS 'Базовый балл лида на момент отправки';
COMMENT ON COLUMN campaign_messages.has_reply IS 'Ответил ли лид на это сообщение';
COMMENT ON COLUMN campaign_messages.first_reply_at IS 'Время первого ответа лида на сообщение';
COMMENT ON COLUMN campaign_messages.led_to_target_action IS 'Привело ли сообщение к целевому действию (переход на ключевой этап)';
COMMENT ON COLUMN campaign_messages.target_action_type IS 'Тип целевого действия (key_stage_transition)';
COMMENT ON COLUMN campaign_messages.target_action_at IS 'Когда произошло целевое действие';

-- Индексы для оптимизации аналитических запросов
CREATE INDEX IF NOT EXISTS idx_campaign_messages_reply 
  ON campaign_messages(user_account_id, has_reply, sent_at) 
  WHERE has_reply = true;

CREATE INDEX IF NOT EXISTS idx_campaign_messages_action 
  ON campaign_messages(user_account_id, led_to_target_action, target_action_at) 
  WHERE led_to_target_action = true;

CREATE INDEX IF NOT EXISTS idx_campaign_messages_analytics 
  ON campaign_messages(user_account_id, interest_level_at_send, funnel_stage_at_send, strategy_type, sent_at);

CREATE INDEX IF NOT EXISTS idx_campaign_messages_lead_sent 
  ON campaign_messages(lead_id, sent_at DESC) 
  WHERE status = 'sent';

-- ===== 2. Таблица lead_daily_snapshot =====

CREATE TABLE IF NOT EXISTS lead_daily_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES dialog_analysis(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  interest_level TEXT CHECK (interest_level IN ('hot', 'warm', 'cold')),
  score INTEGER,
  funnel_stage TEXT,
  campaign_messages_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_lead_snapshot UNIQUE(lead_id, snapshot_date)
);

-- Индексы для быстрого доступа к снимкам
CREATE INDEX IF NOT EXISTS idx_lead_snapshot_user_date 
  ON lead_daily_snapshot(user_account_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_lead_snapshot_lead 
  ON lead_daily_snapshot(lead_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_lead_snapshot_interest 
  ON lead_daily_snapshot(user_account_id, snapshot_date, interest_level);

-- Комментарии
COMMENT ON TABLE lead_daily_snapshot IS 'Ежедневные снимки состояния лидов для отслеживания динамики изменений';
COMMENT ON COLUMN lead_daily_snapshot.snapshot_date IS 'Дата снимка (без времени)';
COMMENT ON COLUMN lead_daily_snapshot.interest_level IS 'Температура лида на момент снимка';
COMMENT ON COLUMN lead_daily_snapshot.score IS 'Балл лида на момент снимка';
COMMENT ON COLUMN lead_daily_snapshot.funnel_stage IS 'Этап воронки на момент снимка';
COMMENT ON COLUMN lead_daily_snapshot.campaign_messages_count IS 'Количество отправленных сообщений на момент снимка';

-- ===== 3. SQL функции для аналитики =====

-- Функция расчета reply rate
CREATE OR REPLACE FUNCTION calculate_reply_rate(
  p_user_account_id UUID,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL
) RETURNS DECIMAL AS $$
DECLARE
  v_total_leads INTEGER;
  v_replied_leads INTEGER;
BEGIN
  -- Считаем уникальных лидов, которым отправили сообщения
  SELECT COUNT(DISTINCT lead_id)
  INTO v_total_leads
  FROM campaign_messages
  WHERE user_account_id = p_user_account_id
    AND status = 'sent'
    AND (p_date_from IS NULL OR sent_at >= p_date_from)
    AND (p_date_to IS NULL OR sent_at <= p_date_to);
  
  -- Если нет отправленных сообщений, возвращаем 0
  IF v_total_leads = 0 THEN
    RETURN 0;
  END IF;
  
  -- Считаем уникальных лидов, которые ответили
  SELECT COUNT(DISTINCT lead_id)
  INTO v_replied_leads
  FROM campaign_messages
  WHERE user_account_id = p_user_account_id
    AND status = 'sent'
    AND has_reply = true
    AND (p_date_from IS NULL OR sent_at >= p_date_from)
    AND (p_date_to IS NULL OR sent_at <= p_date_to);
  
  -- Возвращаем процент
  RETURN ROUND((v_replied_leads::DECIMAL / v_total_leads::DECIMAL) * 100, 2);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_reply_rate IS 'Рассчитывает процент уникальных лидов, ответивших на рассылку';

-- Функция расчета conversion rate
CREATE OR REPLACE FUNCTION calculate_conversion_rate(
  p_user_account_id UUID,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL
) RETURNS DECIMAL AS $$
DECLARE
  v_total_leads INTEGER;
  v_converted_leads INTEGER;
BEGIN
  -- Считаем уникальных лидов, которым отправили сообщения
  SELECT COUNT(DISTINCT lead_id)
  INTO v_total_leads
  FROM campaign_messages
  WHERE user_account_id = p_user_account_id
    AND status = 'sent'
    AND (p_date_from IS NULL OR sent_at >= p_date_from)
    AND (p_date_to IS NULL OR sent_at <= p_date_to);
  
  -- Если нет отправленных сообщений, возвращаем 0
  IF v_total_leads = 0 THEN
    RETURN 0;
  END IF;
  
  -- Считаем уникальных лидов с целевым действием
  SELECT COUNT(DISTINCT lead_id)
  INTO v_converted_leads
  FROM campaign_messages
  WHERE user_account_id = p_user_account_id
    AND status = 'sent'
    AND led_to_target_action = true
    AND (p_date_from IS NULL OR sent_at >= p_date_from)
    AND (p_date_to IS NULL OR sent_at <= p_date_to);
  
  -- Возвращаем процент
  RETURN ROUND((v_converted_leads::DECIMAL / v_total_leads::DECIMAL) * 100, 2);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_conversion_rate IS 'Рассчитывает процент лидов с целевым действием (переход на ключевой этап)';

-- Функция получения динамики температуры
CREATE OR REPLACE FUNCTION get_temperature_dynamics(
  p_user_account_id UUID,
  p_days INTEGER DEFAULT 30
) RETURNS TABLE(
  snapshot_date DATE,
  hot_count BIGINT,
  warm_count BIGINT,
  cold_count BIGINT,
  total_leads BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.snapshot_date,
    COUNT(*) FILTER (WHERE s.interest_level = 'hot') AS hot_count,
    COUNT(*) FILTER (WHERE s.interest_level = 'warm') AS warm_count,
    COUNT(*) FILTER (WHERE s.interest_level = 'cold') AS cold_count,
    COUNT(*) AS total_leads
  FROM lead_daily_snapshot s
  WHERE s.user_account_id = p_user_account_id
    AND s.snapshot_date >= CURRENT_DATE - p_days
  GROUP BY s.snapshot_date
  ORDER BY s.snapshot_date DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_temperature_dynamics IS 'Возвращает ежедневную динамику распределения температуры лидов';

-- ===== 4. Вспомогательные функции =====

-- Функция для получения среднего времени до ответа (в часах)
CREATE OR REPLACE FUNCTION get_avg_time_to_reply(
  p_user_account_id UUID,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL
) RETURNS DECIMAL AS $$
DECLARE
  v_avg_hours DECIMAL;
BEGIN
  SELECT AVG(EXTRACT(EPOCH FROM (first_reply_at - sent_at)) / 3600)
  INTO v_avg_hours
  FROM campaign_messages
  WHERE user_account_id = p_user_account_id
    AND status = 'sent'
    AND has_reply = true
    AND first_reply_at IS NOT NULL
    AND sent_at IS NOT NULL
    AND (p_date_from IS NULL OR sent_at >= p_date_from)
    AND (p_date_to IS NULL OR sent_at <= p_date_to);
  
  RETURN COALESCE(ROUND(v_avg_hours, 1), 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_avg_time_to_reply IS 'Возвращает среднее время до ответа в часах';

-- Функция для получения среднего времени до целевого действия (в днях)
CREATE OR REPLACE FUNCTION get_avg_time_to_action(
  p_user_account_id UUID,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL
) RETURNS DECIMAL AS $$
DECLARE
  v_avg_days DECIMAL;
BEGIN
  SELECT AVG(EXTRACT(EPOCH FROM (target_action_at - sent_at)) / 86400)
  INTO v_avg_days
  FROM campaign_messages
  WHERE user_account_id = p_user_account_id
    AND status = 'sent'
    AND led_to_target_action = true
    AND target_action_at IS NOT NULL
    AND sent_at IS NOT NULL
    AND (p_date_from IS NULL OR sent_at >= p_date_from)
    AND (p_date_to IS NULL OR sent_at <= p_date_to);
  
  RETURN COALESCE(ROUND(v_avg_days, 1), 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_avg_time_to_action IS 'Возвращает среднее время до целевого действия в днях';



