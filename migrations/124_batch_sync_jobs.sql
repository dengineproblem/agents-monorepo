-- ============================================================================
-- BATCH SYNC JOBS
-- Tracking для массовой синхронизации Ad Insights по всем аккаунтам
-- ============================================================================

-- 1. Основная таблица batch jobs
CREATE TABLE IF NOT EXISTS batch_sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Тип batch job
    job_type TEXT NOT NULL DEFAULT 'full_insights_sync',

    -- Статус
    status TEXT DEFAULT 'pending',  -- pending, running, paused, completed, failed

    -- Прогресс
    total_accounts INTEGER NOT NULL,
    processed_accounts INTEGER DEFAULT 0,
    failed_accounts INTEGER DEFAULT 0,
    skipped_accounts INTEGER DEFAULT 0,  -- rate limited, invalid token, etc.

    -- Параметры запуска
    params JSONB,  -- {workers, pause_ms, skip_fullsync, skip_burnout, etc.}

    -- Статистика (агрегат по всем аккаунтам)
    stats JSONB DEFAULT '{}',  -- {total_campaigns, total_insights, total_anomalies, etc.}

    -- Время
    started_at TIMESTAMPTZ,
    paused_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Последняя активность (для мониторинга зависших jobs)
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_batch_sync_jobs_status ON batch_sync_jobs(status);
CREATE INDEX idx_batch_sync_jobs_type ON batch_sync_jobs(job_type);
CREATE INDEX idx_batch_sync_jobs_created ON batch_sync_jobs(created_at DESC);

-- 2. Детальный лог по каждому аккаунту в batch
CREATE TABLE IF NOT EXISTS batch_sync_account_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_job_id UUID NOT NULL REFERENCES batch_sync_jobs(id) ON DELETE CASCADE,
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,

    -- Статус обработки
    status TEXT DEFAULT 'pending',  -- pending, running, completed, failed, skipped

    -- Шаги pipeline
    step_fullsync TEXT DEFAULT 'pending',    -- pending, running, completed, failed, skipped
    step_features TEXT DEFAULT 'pending',
    step_anomalies TEXT DEFAULT 'pending',
    step_daily TEXT DEFAULT 'pending',       -- daily breakdown enrichment
    step_burnout TEXT DEFAULT 'pending',

    -- Результаты
    result_summary JSONB,  -- {campaigns: 50, adsets: 120, ads: 350, insights: 1200, anomalies: 5, predictions: 12}

    -- Ошибки
    last_error TEXT,
    error_type TEXT,  -- token_invalid, rate_limited, network_error, data_error, unknown
    attempts INTEGER DEFAULT 0,

    -- Время
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_seconds INTEGER,

    -- Worker ID (для дебага параллельной обработки)
    worker_id INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(batch_job_id, ad_account_id)
);

CREATE INDEX idx_batch_sync_account_log_job ON batch_sync_account_log(batch_job_id);
CREATE INDEX idx_batch_sync_account_log_status ON batch_sync_account_log(status);
CREATE INDEX idx_batch_sync_account_log_account ON batch_sync_account_log(ad_account_id);

-- 3. Комментарии
COMMENT ON TABLE batch_sync_jobs IS 'Batch jobs для массовой синхронизации Ad Insights';
COMMENT ON TABLE batch_sync_account_log IS 'Детальный лог обработки каждого аккаунта в batch job';
COMMENT ON COLUMN batch_sync_account_log.error_type IS 'Тип ошибки: token_invalid, rate_limited, network_error, data_error, unknown';
COMMENT ON COLUMN batch_sync_account_log.worker_id IS 'ID воркера для отладки параллельной обработки';
