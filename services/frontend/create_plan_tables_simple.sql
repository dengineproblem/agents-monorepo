-- Упрощенное создание таблиц для планов (без триггеров и функций)

-- Таблица направлений пользователей
CREATE TABLE user_directions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  main_direction VARCHAR(255) NOT NULL,
  sub_direction VARCHAR(255) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, main_direction, sub_direction)
);

-- Таблица плановых показателей
CREATE TABLE planned_metrics (
  id SERIAL PRIMARY KEY,
  user_direction_id INTEGER NOT NULL REFERENCES user_directions(id) ON DELETE CASCADE,
  metric_type VARCHAR(50) NOT NULL CHECK (metric_type IN ('leads', 'spend')),
  planned_monthly_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_direction_id, metric_type)
);

-- Индексы для оптимизации
CREATE INDEX idx_user_directions_user_id ON user_directions(user_id);
CREATE INDEX idx_planned_metrics_direction_id ON planned_metrics(user_direction_id);