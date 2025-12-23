-- ============================================================================
-- AD BURNOUT PREDICTIONS & DECAY RECOVERY
-- Таблицы для хранения предсказаний выгорания и восстановления
-- Поддержка legacy (user_account_id) и multi-account (ad_account_id) режимов
-- ============================================================================

-- Удаляем если существуют (для чистого пересоздания)
DROP TABLE IF EXISTS lag_dependency_stats CASCADE;
DROP TABLE IF EXISTS ad_decay_recovery CASCADE;
DROP TABLE IF EXISTS ad_burnout_predictions CASCADE;

-- 1. BURNOUT PREDICTIONS
CREATE TABLE ad_burnout_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Multi-account: FK к ad_accounts.id (UUID)
    ad_account_id UUID NOT NULL,

    -- Legacy fallback: FK к user_accounts.id (для legacy пользователей)
    user_account_id UUID,

    fb_ad_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,

    -- Prediction
    burnout_score DECIMAL(4,3) DEFAULT 0,  -- 0-1
    burnout_level TEXT DEFAULT 'low',       -- low, medium, high, critical

    -- Predicted CPR changes
    predicted_cpr_change_1w DECIMAL(8,2) DEFAULT 0,  -- % change in 1 week
    predicted_cpr_change_2w DECIMAL(8,2) DEFAULT 0,  -- % change in 2 weeks

    -- Confidence
    confidence DECIMAL(4,3) DEFAULT 0,  -- 0-1

    -- Top signals that drive the prediction
    top_signals JSONB DEFAULT '[]',  -- [{signal: string, weight: number}]

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_ad_id, week_start_date)
);

CREATE INDEX idx_burnout_account ON ad_burnout_predictions(ad_account_id);
CREATE INDEX idx_burnout_user ON ad_burnout_predictions(user_account_id) WHERE user_account_id IS NOT NULL;
CREATE INDEX idx_burnout_week ON ad_burnout_predictions(week_start_date);
CREATE INDEX idx_burnout_level ON ad_burnout_predictions(burnout_level);

-- 2. DECAY / RECOVERY TRACKING
CREATE TABLE ad_decay_recovery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Multi-account: FK к ad_accounts.id (UUID)
    ad_account_id UUID NOT NULL,

    -- Legacy fallback
    user_account_id UUID,

    fb_ad_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,

    -- Current status
    status TEXT DEFAULT 'healthy',  -- healthy, degraded, burned_out, recovering

    -- Recovery prediction
    recovery_score DECIMAL(4,3) DEFAULT 0,  -- 0-1
    recovery_level TEXT DEFAULT 'unlikely', -- unlikely, possible, likely

    -- Predicted changes
    predicted_cpr_change_1w DECIMAL(8,2) DEFAULT 0,
    predicted_cpr_change_2w DECIMAL(8,2) DEFAULT 0,

    -- Signals
    top_signals JSONB DEFAULT '[]',

    confidence DECIMAL(4,3) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_ad_id, week_start_date)
);

CREATE INDEX idx_decay_account ON ad_decay_recovery(ad_account_id);
CREATE INDEX idx_decay_user ON ad_decay_recovery(user_account_id) WHERE user_account_id IS NOT NULL;
CREATE INDEX idx_decay_status ON ad_decay_recovery(status);

-- 3. LAG DEPENDENCY STATS (for lead-lag analysis)
CREATE TABLE lag_dependency_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Multi-account: FK к ad_accounts.id (UUID)
    ad_account_id UUID NOT NULL,

    -- Legacy fallback
    user_account_id UUID,

    -- Metric being analyzed
    metric_name TEXT NOT NULL,

    -- Correlation with CPR at different lags
    corr_lag_1w DECIMAL(5,4),  -- correlation with CPR 1 week later
    corr_lag_2w DECIMAL(5,4),  -- correlation with CPR 2 weeks later

    -- Quantile analysis
    quantile_analysis JSONB,  -- detailed breakdown by quantiles

    -- Sample size
    sample_size INTEGER DEFAULT 0,

    -- Timestamps
    computed_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, metric_name)
);

CREATE INDEX idx_lag_stats_account ON lag_dependency_stats(ad_account_id);
CREATE INDEX idx_lag_stats_user ON lag_dependency_stats(user_account_id) WHERE user_account_id IS NOT NULL;

-- Comments
COMMENT ON TABLE ad_burnout_predictions IS 'Предсказания выгорания объявлений на основе lead-lag анализа';
COMMENT ON TABLE ad_decay_recovery IS 'Отслеживание деградации и восстановления объявлений';
COMMENT ON TABLE lag_dependency_stats IS 'Статистика корреляций метрик с будущим CPR';

COMMENT ON COLUMN ad_burnout_predictions.ad_account_id IS 'UUID from ad_accounts.id (multi-account mode)';
COMMENT ON COLUMN ad_burnout_predictions.user_account_id IS 'UUID from user_accounts.id (legacy fallback)';
