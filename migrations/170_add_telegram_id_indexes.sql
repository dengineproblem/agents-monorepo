-- Add indexes for fast telegram_id lookups in user_ai_usage
-- Проблема: запросы к user_ai_usage по telegram_id медленные (5 сек) без индекса

-- Составной индекс для быстрого поиска по telegram_id + date
CREATE INDEX IF NOT EXISTS idx_user_ai_usage_telegram_date
  ON user_ai_usage(telegram_id, date);

-- Отдельный индекс на telegram_id для общих запросов
CREATE INDEX IF NOT EXISTS idx_user_ai_usage_telegram
  ON user_ai_usage(telegram_id);

-- Проверить что PRIMARY KEY на telegram_id существует в user_ai_limits
-- (должен был быть создан в migration 169)
-- Если нет - создаём
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_ai_limits_pkey'
    AND conrelid = 'user_ai_limits'::regclass
  ) THEN
    ALTER TABLE user_ai_limits ADD PRIMARY KEY (telegram_id);
  END IF;
END $$;

COMMENT ON INDEX idx_user_ai_usage_telegram_date IS 'Fast lookup for daily usage queries by telegram_id and date';
COMMENT ON INDEX idx_user_ai_usage_telegram IS 'Fast lookup for usage queries by telegram_id';
