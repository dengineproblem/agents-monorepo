-- Создание таблицы плановых показателей
CREATE TABLE planned_metrics (
  id SERIAL PRIMARY KEY,
  user_direction_id INTEGER NOT NULL,
  metric_type VARCHAR(50) NOT NULL,
  planned_monthly_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);