-- ============================================================================
-- FIX LAG DEPENDENCY STATS
-- Исправляет схему lag_dependency_stats для burnoutAnalyzer
-- ============================================================================

-- Пересоздаём таблицу с правильными колонками
DROP TABLE IF EXISTS lag_dependency_stats CASCADE;

CREATE TABLE lag_dependency_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Multi-account: FK к ad_accounts.id (UUID)
    ad_account_id UUID NOT NULL,

    -- Legacy fallback
    user_account_id UUID,

    -- Metric identification
    result_family TEXT NOT NULL DEFAULT 'all',  -- leads, qualified_leads, all
    metric_name TEXT NOT NULL,
    prediction_type TEXT DEFAULT 'burnout',     -- burnout, recovery

    -- Correlation with CPR at different lags
    corr_lag_1w DECIMAL(5,4),
    corr_lag_2w DECIMAL(5,4),

    -- CPR growth analysis
    avg_cpr_growth_when_triggered DECIMAL(8,2) DEFAULT 0,

    -- Trigger analysis
    trigger_frequency DECIMAL(4,3) DEFAULT 0,   -- How often this metric triggers
    predictive_power DECIMAL(4,3) DEFAULT 0,    -- Confidence/power of prediction
    recommended_threshold DECIMAL(6,3) DEFAULT 0,
    time_lag_weeks INTEGER DEFAULT 2,

    -- Quantile analysis
    quantile_analysis JSONB,

    -- Sample size
    sample_size INTEGER DEFAULT 0,

    -- Timestamps
    computed_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, result_family, metric_name)
);

CREATE INDEX idx_lag_stats_account ON lag_dependency_stats(ad_account_id);
CREATE INDEX idx_lag_stats_user ON lag_dependency_stats(user_account_id) WHERE user_account_id IS NOT NULL;
CREATE INDEX idx_lag_stats_family ON lag_dependency_stats(result_family);

COMMENT ON TABLE lag_dependency_stats IS 'Статистика корреляций метрик с будущим CPR и recovery predictions';
COMMENT ON COLUMN lag_dependency_stats.result_family IS 'Тип результата: leads, qualified_leads, all';
COMMENT ON COLUMN lag_dependency_stats.prediction_type IS 'Тип предсказания: burnout или recovery';
COMMENT ON COLUMN lag_dependency_stats.avg_cpr_growth_when_triggered IS 'Средний рост CPR когда метрика срабатывает';
