-- Таблица для хранения результатов утреннего batch агента Brain
-- Используется для генерации отчёта мониторинга в 9:00

CREATE TABLE IF NOT EXISTS batch_execution_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_date DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,

  -- Общая статистика
  total_users INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER,

  -- Детали по каждому пользователю (JSONB массив)
  -- Структура: [{ userId, username, accountId, success, error, duration, actionsCount }]
  results JSONB NOT NULL DEFAULT '[]',

  -- Метаданные
  instance_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для быстрого поиска по дате
CREATE INDEX IF NOT EXISTS idx_batch_results_date ON batch_execution_results(execution_date DESC);

-- RLS политики
ALTER TABLE batch_execution_results ENABLE ROW LEVEL SECURITY;

-- Только service role может читать и писать
CREATE POLICY "Service role full access" ON batch_execution_results
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE batch_execution_results IS 'Результаты утреннего batch запуска агента Brain для мониторинга';
COMMENT ON COLUMN batch_execution_results.results IS 'JSONB массив с детальной информацией по каждому пользователю';
