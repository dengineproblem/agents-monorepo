-- Создание таблиц для работы с планами направлений
-- user_directions: хранит направления пользователей
-- planned_metrics: хранит плановые показатели для каждого направления

-- Таблица направлений пользователей
CREATE TABLE IF NOT EXISTS user_directions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  main_direction VARCHAR(255) NOT NULL,
  sub_direction VARCHAR(255) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Уникальность: один пользователь не может иметь дублирующиеся направления
  UNIQUE(user_id, main_direction, sub_direction)
);

-- Таблица плановых показателей
CREATE TABLE IF NOT EXISTS planned_metrics (
  id SERIAL PRIMARY KEY,
  user_direction_id INTEGER NOT NULL REFERENCES user_directions(id) ON DELETE CASCADE,
  metric_type VARCHAR(50) NOT NULL CHECK (metric_type IN ('leads', 'spend')),
  planned_monthly_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Уникальность: для одного направления один тип метрики
  UNIQUE(user_direction_id, metric_type)
);

-- Создание индексов для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_user_directions_user_id ON user_directions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_directions_main ON user_directions(main_direction);
CREATE INDEX IF NOT EXISTS idx_planned_metrics_direction_id ON planned_metrics(user_direction_id);
CREATE INDEX IF NOT EXISTS idx_planned_metrics_type ON planned_metrics(metric_type);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггеры для автоматического обновления updated_at
CREATE TRIGGER update_user_directions_updated_at BEFORE UPDATE ON user_directions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_planned_metrics_updated_at BEFORE UPDATE ON planned_metrics 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Комментарии к таблицам
COMMENT ON TABLE user_directions IS 'Направления бизнеса пользователей, извлеченные из названий кампаний';
COMMENT ON COLUMN user_directions.user_id IS 'ID пользователя из user_accounts';
COMMENT ON COLUMN user_directions.main_direction IS 'Основное направление (например, "Астана")';
COMMENT ON COLUMN user_directions.sub_direction IS 'Поднаправление (например, "Грыжи")';

COMMENT ON TABLE planned_metrics IS 'Плановые показатели для каждого направления';
COMMENT ON COLUMN planned_metrics.user_direction_id IS 'Ссылка на направление из user_directions';
COMMENT ON COLUMN planned_metrics.metric_type IS 'Тип метрики: leads (лиды) или spend (затраты)';
COMMENT ON COLUMN planned_metrics.planned_monthly_value IS 'Плановое значение на месяц';

-- Примеры использования:

-- 1. Добавить направление для пользователя
-- INSERT INTO user_directions (user_id, main_direction, sub_direction) 
-- VALUES ('user-uuid', 'Астана', 'Грыжи');

-- 2. Добавить плановые показатели для направления
-- INSERT INTO planned_metrics (user_direction_id, metric_type, planned_monthly_value)
-- VALUES 
--   (1, 'leads', 50.00),
--   (1, 'spend', 1000.00);

-- 3. Получить все направления и планы пользователя
-- SELECT 
--   ud.id,
--   ud.main_direction,
--   ud.sub_direction,
--   pm_leads.planned_monthly_value as planned_leads,
--   pm_spend.planned_monthly_value as planned_spend
-- FROM user_directions ud
-- LEFT JOIN planned_metrics pm_leads ON ud.id = pm_leads.user_direction_id AND pm_leads.metric_type = 'leads'
-- LEFT JOIN planned_metrics pm_spend ON ud.id = pm_spend.user_direction_id AND pm_spend.metric_type = 'spend'
-- WHERE ud.user_id = 'user-uuid';