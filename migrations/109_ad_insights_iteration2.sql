-- ============================================================================
-- AD INSIGHTS ITERATION 2
-- Rankings + Campaign/Adset level + Yearly analysis support
-- ============================================================================

-- 1. ДОБАВЛЯЕМ RANKINGS В WEEKLY INSIGHTS
ALTER TABLE meta_insights_weekly
ADD COLUMN IF NOT EXISTS quality_ranking TEXT,
ADD COLUMN IF NOT EXISTS engagement_rate_ranking TEXT,
ADD COLUMN IF NOT EXISTS conversion_rate_ranking TEXT,
ADD COLUMN IF NOT EXISTS quality_rank_score SMALLINT,
ADD COLUMN IF NOT EXISTS engagement_rank_score SMALLINT,
ADD COLUMN IF NOT EXISTS conversion_rank_score SMALLINT;

COMMENT ON COLUMN meta_insights_weekly.quality_ranking IS 'Raw ranking: ABOVE_AVERAGE, AVERAGE, BELOW_AVERAGE_10, BELOW_AVERAGE_20';
COMMENT ON COLUMN meta_insights_weekly.quality_rank_score IS 'Normalized: +2 (above), 0 (average), -1 (below 10%), -2 (below 20%)';

-- 2. ДОБАВЛЯЕМ RELEVANCE FEATURES В AD_WEEKLY_FEATURES
ALTER TABLE ad_weekly_features
ADD COLUMN IF NOT EXISTS quality_score SMALLINT,
ADD COLUMN IF NOT EXISTS engagement_score SMALLINT,
ADD COLUMN IF NOT EXISTS conversion_score SMALLINT,
ADD COLUMN IF NOT EXISTS relevance_health SMALLINT,  -- сумма трёх scores
ADD COLUMN IF NOT EXISTS quality_drop SMALLINT,       -- delta vs baseline
ADD COLUMN IF NOT EXISTS engagement_drop SMALLINT,
ADD COLUMN IF NOT EXISTS conversion_drop SMALLINT,
ADD COLUMN IF NOT EXISTS relevance_drop SMALLINT;

-- 3. CAMPAIGN LEVEL WEEKLY INSIGHTS
CREATE TABLE IF NOT EXISTS meta_insights_weekly_campaign (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    fb_campaign_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,

    -- Метрики
    spend DECIMAL(12,2) DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    frequency DECIMAL(8,4) DEFAULT 0,
    cpm DECIMAL(10,4) DEFAULT 0,
    ctr DECIMAL(8,6) DEFAULT 0,
    cpc DECIMAL(10,4) DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    link_clicks INTEGER DEFAULT 0,

    -- Actions
    actions_json JSONB,
    cost_per_action_type_json JSONB,

    -- Rankings (aggregated)
    quality_ranking TEXT,
    engagement_rate_ranking TEXT,
    conversion_rate_ranking TEXT,

    attribution_window TEXT DEFAULT '7d_click_1d_view',
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_campaign_id, week_start_date)
);

CREATE INDEX idx_insights_campaign_account_week ON meta_insights_weekly_campaign(ad_account_id, week_start_date);
CREATE INDEX idx_insights_campaign_id ON meta_insights_weekly_campaign(fb_campaign_id);

-- 4. ADSET LEVEL WEEKLY INSIGHTS
CREATE TABLE IF NOT EXISTS meta_insights_weekly_adset (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    fb_adset_id TEXT NOT NULL,
    fb_campaign_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,

    -- Метрики
    spend DECIMAL(12,2) DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    frequency DECIMAL(8,4) DEFAULT 0,
    cpm DECIMAL(10,4) DEFAULT 0,
    ctr DECIMAL(8,6) DEFAULT 0,
    cpc DECIMAL(10,4) DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    link_clicks INTEGER DEFAULT 0,

    -- Actions
    actions_json JSONB,
    cost_per_action_type_json JSONB,

    -- Rankings
    quality_ranking TEXT,
    engagement_rate_ranking TEXT,
    conversion_rate_ranking TEXT,

    attribution_window TEXT DEFAULT '7d_click_1d_view',
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_adset_id, week_start_date)
);

CREATE INDEX idx_insights_adset_account_week ON meta_insights_weekly_adset(ad_account_id, week_start_date);
CREATE INDEX idx_insights_adset_campaign ON meta_insights_weekly_adset(fb_campaign_id);

-- 5. YEARLY AUDIT CACHE (для быстрого доступа)
CREATE TABLE IF NOT EXISTS yearly_audit_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    result_family TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- Pareto analysis
    top_ads_by_spend JSONB,       -- [{ad_id, name, spend, pct}]
    top_ads_by_results JSONB,     -- [{ad_id, name, results, pct}]
    top_ads_by_efficiency JSONB,  -- [{ad_id, name, cpr, results}]
    pareto_top10_pct DECIMAL(5,2),  -- какой % результатов дают топ-10% ads

    -- Worst/Best weeks
    worst_cpr_weeks JSONB,        -- [{week, cpr, spend, results}]
    best_cpr_weeks JSONB,

    -- Waste
    zero_result_spend DECIMAL(12,2),  -- spend где results=0
    zero_result_weeks INTEGER,

    -- Stability
    anomaly_free_weeks_pct DECIMAL(5,2),
    total_spikes INTEGER,
    avg_spike_pct DECIMAL(8,2),

    -- Stats
    total_spend DECIMAL(14,2),
    total_results INTEGER,
    avg_cpr DECIMAL(12,4),
    median_cpr DECIMAL(12,4),

    computed_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, result_family, period_start, period_end)
);

-- 6. CREATIVE LIFECYCLE STATS
CREATE TABLE IF NOT EXISTS creative_lifecycle_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    creative_fingerprint TEXT NOT NULL,
    result_family TEXT NOT NULL,

    -- Lifecycle
    first_week DATE,              -- первая неделя с spend>0
    death_week DATE,              -- первая неделя с anomaly (null если жив)
    lifetime_weeks INTEGER,       -- death - first (null если жив)
    is_alive BOOLEAN DEFAULT TRUE,

    -- Performance
    total_spend DECIMAL(12,2),
    total_results INTEGER,
    avg_cpr DECIMAL(12,4),
    cpr_volatility DECIMAL(8,4),  -- CV (coefficient of variation)

    -- Ranking
    avg_quality_score DECIMAL(4,2),
    avg_engagement_score DECIMAL(4,2),
    avg_conversion_score DECIMAL(4,2),

    computed_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, creative_fingerprint, result_family)
);

CREATE INDEX idx_creative_lifecycle_account ON creative_lifecycle_stats(ad_account_id);
CREATE INDEX idx_creative_lifecycle_alive ON creative_lifecycle_stats(is_alive);

-- 7. RESPONSE CURVE DATA (spend buckets → marginal efficiency)
CREATE TABLE IF NOT EXISTS response_curve_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    level TEXT NOT NULL,          -- 'campaign', 'adset', 'account'
    entity_id TEXT,               -- campaign_id или adset_id (null для account)
    result_family TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- Buckets
    spend_buckets JSONB,          -- [{min, max, weeks, spend, results, cpr, marginal_cpr}]
    sweet_spot_min DECIMAL(12,2), -- оптимальный диапазон spend
    sweet_spot_max DECIMAL(12,2),
    saturation_threshold DECIMAL(12,2),  -- после этого spend CPR резко растёт

    computed_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, level, entity_id, result_family, period_start, period_end)
);

-- 8. GOAL DRIFT TRACKING
CREATE TABLE IF NOT EXISTS goal_drift_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    period_type TEXT NOT NULL,    -- 'month', 'quarter'
    period_value TEXT NOT NULL,   -- '2024-01', '2024-Q1'

    -- Spend distribution by objective/optimization_goal
    spend_by_objective JSONB,     -- {OUTCOME_LEADS: 5000, OUTCOME_TRAFFIC: 2000, ...}
    spend_by_optimization_goal JSONB,

    -- Performance by goal
    cpr_by_goal JSONB,            -- {LEAD_GENERATION: 12.5, CONVERSATIONS: 8.2, ...}

    total_spend DECIMAL(14,2),

    computed_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, period_type, period_value)
);

-- 9. TRACKING HEALTH ISSUES
CREATE TABLE IF NOT EXISTS tracking_health_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    week_start_date DATE NOT NULL,

    -- Issue types
    clicks_no_results BOOLEAN DEFAULT FALSE,  -- link_clicks > 0, results = 0
    results_dropped BOOLEAN DEFAULT FALSE,    -- results резко упали при том же spend
    high_volatility BOOLEAN DEFAULT FALSE,    -- CV результатов > threshold

    -- Details
    link_clicks INTEGER,
    results_count INTEGER,
    spend DECIMAL(12,2),
    result_family TEXT,
    volatility_cv DECIMAL(8,4),

    -- Recommendations
    recommendations JSONB,        -- ["check pixel", "check capi", ...]

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, week_start_date, result_family)
);

-- 10. LAG DEPENDENCY STATS (расширяем для recovery)
ALTER TABLE IF EXISTS lag_dependency_stats
ADD COLUMN IF NOT EXISTS prediction_type TEXT DEFAULT 'decay';  -- 'decay' или 'recovery'

-- Если таблицы нет, создаём
CREATE TABLE IF NOT EXISTS lag_dependency_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type TEXT NOT NULL,     -- 'account', 'niche', 'global'
    scope_id TEXT,                -- ad_account_id или niche_id
    result_family TEXT NOT NULL,
    lag_weeks INTEGER NOT NULL,   -- 1 или 2
    prediction_type TEXT DEFAULT 'decay',  -- 'decay' или 'recovery'
    metric_name TEXT NOT NULL,

    -- Binned analysis
    bins_json JSONB,              -- [{min, max, sample_size, spike_rate, median_delta_cpr}]

    sample_size INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(scope_type, scope_id, result_family, lag_weeks, prediction_type, metric_name)
);

-- 11. RANKING SCORE MAPPING (конфиг)
CREATE TABLE IF NOT EXISTS ranking_score_mapping (
    ranking_value TEXT PRIMARY KEY,
    score SMALLINT NOT NULL
);

INSERT INTO ranking_score_mapping (ranking_value, score) VALUES
    ('ABOVE_AVERAGE', 2),
    ('AVERAGE', 0),
    ('BELOW_AVERAGE_10', -1),
    ('BELOW_AVERAGE_20', -2),
    ('BELOW_AVERAGE_35', -3),
    ('UNKNOWN', 0)
ON CONFLICT (ranking_value) DO UPDATE SET score = EXCLUDED.score;

-- 12. SQL FUNCTION: convert ranking to score
CREATE OR REPLACE FUNCTION ranking_to_score(ranking TEXT)
RETURNS SMALLINT AS $$
BEGIN
    IF ranking IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN CASE
        WHEN ranking ILIKE '%ABOVE%' THEN 2
        WHEN ranking = 'AVERAGE' THEN 0
        WHEN ranking ILIKE '%BELOW%35%' THEN -3
        WHEN ranking ILIKE '%BELOW%20%' THEN -2
        WHEN ranking ILIKE '%BELOW%' THEN -1
        ELSE 0
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 13. COMMENTS
COMMENT ON TABLE meta_insights_weekly_campaign IS 'Weekly campaign-level insights for response curve and goal drift analysis';
COMMENT ON TABLE meta_insights_weekly_adset IS 'Weekly adset-level insights for audience saturation analysis';
COMMENT ON TABLE yearly_audit_cache IS 'Cached yearly audit results (Pareto, waste, stability)';
COMMENT ON TABLE creative_lifecycle_stats IS 'Creative lifespan analysis - time to first anomaly';
COMMENT ON TABLE response_curve_data IS 'Spend→Results efficiency curve with saturation zones';
COMMENT ON TABLE goal_drift_data IS 'Objective/goal distribution changes over time';
COMMENT ON TABLE tracking_health_issues IS 'Potential tracking/pixel issues detection';
