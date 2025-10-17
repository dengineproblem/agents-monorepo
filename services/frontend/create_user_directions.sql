-- Создание таблицы направлений пользователей
CREATE TABLE user_directions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  main_direction VARCHAR(255) NOT NULL,
  sub_direction VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);