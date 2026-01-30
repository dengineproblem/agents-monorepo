-- Таблица отслеживания использования AI
-- Хранит статистику по токенам и затратам для каждого пользователя по дням
CREATE TABLE user_ai_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  telegram_id TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Модель AI (gpt-5.2, claude-sonnet-4, gpt-4o)
  model TEXT NOT NULL,

  -- Метрики использования
  prompt_tokens INT DEFAULT 0,
  completion_tokens INT DEFAULT 0,
  total_tokens INT DEFAULT 0,

  -- Стоимость в USD
  cost_usd DECIMAL(10,6) DEFAULT 0,

  -- Количество запросов
  request_count INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(telegram_id, date, model)
);

-- Индексы для быстрого поиска
CREATE INDEX idx_user_ai_usage_telegram_date ON user_ai_usage(telegram_id, date);
CREATE INDEX idx_user_ai_usage_date ON user_ai_usage(date);
CREATE INDEX idx_user_ai_usage_cost ON user_ai_usage(cost_usd DESC);

-- Таблица лимитов затрат для пользователей
CREATE TABLE user_ai_limits (
  user_account_id UUID PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  telegram_id TEXT UNIQUE NOT NULL,

  -- Лимиты в USD
  daily_limit_usd DECIMAL(10,2) DEFAULT 1.00,  -- $1/день по умолчанию (консервативно)
  monthly_limit_usd DECIMAL(10,2) DEFAULT 20.00,

  -- Флаг для VIP пользователей без лимитов
  is_unlimited BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_ai_limits_telegram ON user_ai_limits(telegram_id);

-- Функция для инкрементального обновления usage
-- Используется для атомарного добавления метрик к существующим значениям
CREATE OR REPLACE FUNCTION increment_usage(
  p_telegram_id TEXT,
  p_date DATE,
  p_model TEXT,
  p_prompt_tokens INT,
  p_completion_tokens INT,
  p_cost_usd DECIMAL,
  p_request_count INT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO user_ai_usage (
    telegram_id, date, model,
    prompt_tokens, completion_tokens, total_tokens,
    cost_usd, request_count
  )
  VALUES (
    p_telegram_id, p_date, p_model,
    p_prompt_tokens, p_completion_tokens, p_prompt_tokens + p_completion_tokens,
    p_cost_usd, p_request_count
  )
  ON CONFLICT (telegram_id, date, model) DO UPDATE SET
    prompt_tokens = user_ai_usage.prompt_tokens + EXCLUDED.prompt_tokens,
    completion_tokens = user_ai_usage.completion_tokens + EXCLUDED.completion_tokens,
    total_tokens = user_ai_usage.total_tokens + EXCLUDED.total_tokens,
    cost_usd = user_ai_usage.cost_usd + EXCLUDED.cost_usd,
    request_count = user_ai_usage.request_count + EXCLUDED.request_count,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического создания дефолтного лимита
-- При первом использовании AI создаётся запись с лимитом $1/день
CREATE OR REPLACE FUNCTION create_default_limit() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_ai_limits (telegram_id, daily_limit_usd)
  VALUES (NEW.telegram_id, 1.00)
  ON CONFLICT (telegram_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_default_limit
AFTER INSERT ON user_ai_usage
FOR EACH ROW
EXECUTE FUNCTION create_default_limit();
