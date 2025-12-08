-- Migration: 085_error_logs.sql
-- Description: Таблица для логирования ошибок с LLM расшифровкой
-- Created: 2024-12-08
-- Docs: docs/ADMIN_PANEL.md

CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID REFERENCES user_accounts(id) ON DELETE SET NULL,

  -- Контекст ошибки
  error_type VARCHAR(50) NOT NULL, -- 'api', 'facebook', 'cron', 'frontend'
  error_code VARCHAR(100),
  raw_error TEXT NOT NULL,
  stack_trace TEXT,

  -- Контекст действия
  action VARCHAR(100), -- 'create_campaign', 'fetch_metrics', etc.
  endpoint VARCHAR(200),
  request_data JSONB,

  -- LLM расшифровка
  llm_explanation TEXT,
  llm_solution TEXT,
  severity VARCHAR(20) DEFAULT 'warning', -- 'critical', 'warning', 'info'

  -- Статус
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES user_accounts(id),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_error_logs_user ON error_logs(user_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_type ON error_logs(error_type, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_unresolved ON error_logs(is_resolved, created_at DESC) WHERE is_resolved = false;
CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON error_logs(severity, created_at DESC);

-- Комментарии
COMMENT ON TABLE error_logs IS 'Логи ошибок системы с LLM расшифровкой для админ-панели';
COMMENT ON COLUMN error_logs.error_type IS 'Тип ошибки: api, facebook, cron, frontend';
COMMENT ON COLUMN error_logs.severity IS 'Критичность: critical, warning, info';
COMMENT ON COLUMN error_logs.llm_explanation IS 'Расшифровка ошибки человеческим языком от LLM';
COMMENT ON COLUMN error_logs.llm_solution IS 'Рекомендуемое решение от LLM';
