-- Миграция: Добавление полей бюджета в user_briefing_responses
-- Дата: 2025-01-09
-- Описание: Добавляем plan_daily_budget и default_cpl_target для Brain Mini оптимизатора

-- Добавляем новые поля в таблицу user_briefing_responses
ALTER TABLE user_briefing_responses
ADD COLUMN IF NOT EXISTS plan_daily_budget NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS default_cpl_target NUMERIC(10, 2);

-- Комментарии к новым полям
COMMENT ON COLUMN user_briefing_responses.plan_daily_budget IS 'Плановый дневной бюджет на рекламу в рублях';
COMMENT ON COLUMN user_briefing_responses.default_cpl_target IS 'Целевая стоимость заявки (CPL) в рублях';
