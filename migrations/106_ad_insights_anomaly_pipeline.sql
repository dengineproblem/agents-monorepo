-- ============================================================================
-- AD INSIGHTS ANOMALY PIPELINE
-- Weekly ad-level insights with CPR anomaly detection
-- ============================================================================

-- 1. СПРАВОЧНИК КАМПАНИЙ
CREATE TABLE IF NOT EXISTS meta_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    fb_campaign_id TEXT NOT NULL,
    name TEXT,
    status TEXT,  -- ACTIVE, PAUSED, DELETED, ARCHIVED
    objective TEXT,  -- OUTCOME_LEADS, OUTCOME_TRAFFIC, OUTCOME_SALES, etc.
    created_time TIMESTAMPTZ,
    updated_time TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_campaign_id)
);

CREATE INDEX idx_meta_campaigns_account ON meta_campaigns(ad_account_id);
CREATE INDEX idx_meta_campaigns_objective ON meta_campaigns(objective);

-- 2. СПРАВОЧНИК ADSETS
CREATE TABLE IF NOT EXISTS meta_adsets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    fb_adset_id TEXT NOT NULL,
    fb_campaign_id TEXT NOT NULL,
    name TEXT,
    status TEXT,
    optimization_goal TEXT,  -- LEAD_GENERATION, CONVERSATIONS, LINK_CLICKS, etc.
    billing_event TEXT,  -- IMPRESSIONS, LINK_CLICKS, etc.
    targeting JSONB,  -- полный targeting объект
    created_time TIMESTAMPTZ,
    updated_time TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_adset_id)
);

CREATE INDEX idx_meta_adsets_account ON meta_adsets(ad_account_id);
CREATE INDEX idx_meta_adsets_campaign ON meta_adsets(fb_campaign_id);
CREATE INDEX idx_meta_adsets_optimization ON meta_adsets(optimization_goal);

-- 3. СПРАВОЧНИК ОБЪЯВЛЕНИЙ
CREATE TABLE IF NOT EXISTS meta_ads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    fb_ad_id TEXT NOT NULL,
    fb_adset_id TEXT NOT NULL,
    fb_campaign_id TEXT NOT NULL,
    fb_creative_id TEXT,
    name TEXT,
    status TEXT,
    creative_fingerprint TEXT,  -- для группировки одинаковых креативов
    object_story_spec JSONB,  -- детали креатива
    created_time TIMESTAMPTZ,
    updated_time TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_ad_id)
);

CREATE INDEX idx_meta_ads_account ON meta_ads(ad_account_id);
CREATE INDEX idx_meta_ads_adset ON meta_ads(fb_adset_id);
CREATE INDEX idx_meta_ads_campaign ON meta_ads(fb_campaign_id);
CREATE INDEX idx_meta_ads_creative ON meta_ads(fb_creative_id);

-- 4. WEEKLY INSIGHTS (ядро системы)
CREATE TABLE IF NOT EXISTS meta_insights_weekly (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    fb_ad_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,  -- понедельник недели

    -- Базовые метрики
    spend DECIMAL(12,2) DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    frequency DECIMAL(8,4) DEFAULT 0,

    -- Вычисляемые метрики
    cpm DECIMAL(10,4) DEFAULT 0,
    ctr DECIMAL(8,6) DEFAULT 0,
    cpc DECIMAL(10,4) DEFAULT 0,

    -- Клики
    link_clicks INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,

    -- Actions (JSON для гибкости)
    actions_json JSONB,  -- [{action_type, value}]
    cost_per_action_type_json JSONB,  -- [{action_type, value}]

    -- Видео метрики
    video_views INTEGER DEFAULT 0,
    video_p25_watched INTEGER DEFAULT 0,
    video_p50_watched INTEGER DEFAULT 0,
    video_p75_watched INTEGER DEFAULT 0,
    video_p95_watched INTEGER DEFAULT 0,
    video_avg_time_watched_sec DECIMAL(10,2) DEFAULT 0,

    -- Quality rankings
    quality_ranking TEXT,
    engagement_rate_ranking TEXT,
    conversion_rate_ranking TEXT,

    -- Meta
    attribution_window TEXT DEFAULT '7d_click_1d_view',
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_ad_id, week_start_date)
);

CREATE INDEX idx_insights_weekly_account_week ON meta_insights_weekly(ad_account_id, week_start_date);
CREATE INDEX idx_insights_weekly_ad_week ON meta_insights_weekly(fb_ad_id, week_start_date);
CREATE INDEX idx_insights_weekly_week ON meta_insights_weekly(week_start_date);

-- 5. НОРМАЛИЗОВАННЫЕ РЕЗУЛЬТАТЫ ПО СЕМЕЙСТВАМ
-- result_family: messages, leadgen_form, website_lead, purchase, click, other
CREATE TABLE IF NOT EXISTS meta_weekly_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    fb_ad_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,

    result_family TEXT NOT NULL,  -- messages, leadgen_form, website_lead, purchase, click
    result_count INTEGER DEFAULT 0,
    spend DECIMAL(12,2) DEFAULT 0,
    cpr DECIMAL(12,4),  -- cost per result = spend / result_count

    -- Детализация action_types внутри семейства
    action_types_detail JSONB,  -- [{action_type: 'lead', count: 5}, ...]

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_ad_id, week_start_date, result_family)
);

CREATE INDEX idx_weekly_results_account ON meta_weekly_results(ad_account_id);
CREATE INDEX idx_weekly_results_ad_week ON meta_weekly_results(fb_ad_id, week_start_date);
CREATE INDEX idx_weekly_results_family ON meta_weekly_results(result_family);

-- 6. ФИЧИ ДЛЯ АНАЛИЗА (агрегированные метрики + лаги)
CREATE TABLE IF NOT EXISTS ad_weekly_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    fb_ad_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,

    -- Выбранное семейство результатов для этого ad
    primary_family TEXT,  -- messages, leadgen_form, etc.

    -- Текущие метрики
    spend DECIMAL(12,2),
    frequency DECIMAL(8,4),
    ctr DECIMAL(8,6),
    cpc DECIMAL(10,4),
    cpm DECIMAL(10,4),
    reach INTEGER,
    result_count INTEGER,
    cpr DECIMAL(12,4),

    -- Baseline (медиана за последние 8 недель)
    baseline_cpr DECIMAL(12,4),
    baseline_frequency DECIMAL(8,4),
    baseline_ctr DECIMAL(8,6),
    baseline_cpc DECIMAL(10,4),

    -- Дельты vs baseline
    cpr_delta_pct DECIMAL(8,4),  -- (current - baseline) / baseline * 100
    freq_delta_pct DECIMAL(8,4),
    ctr_delta_pct DECIMAL(8,4),
    cpc_delta_pct DECIMAL(8,4),

    -- Лаги (предыдущие недели)
    cpr_lag1 DECIMAL(12,4),  -- неделя t-1
    cpr_lag2 DECIMAL(12,4),  -- неделя t-2
    freq_lag1 DECIMAL(8,4),
    freq_lag2 DECIMAL(8,4),
    ctr_lag1 DECIMAL(8,6),
    ctr_lag2 DECIMAL(8,6),

    -- Slopes (тренды)
    freq_slope DECIMAL(8,6),  -- рост частоты за последние 4 недели
    ctr_slope DECIMAL(8,6),   -- изменение CTR
    reach_growth_rate DECIMAL(8,6),  -- темп роста охвата
    spend_change_pct DECIMAL(8,4),   -- изменение бюджета vs прошлая неделя

    -- Качество данных
    weeks_with_data INTEGER DEFAULT 0,  -- сколько недель есть данные
    min_results_met BOOLEAN DEFAULT FALSE,  -- достаточно результатов для анализа

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_ad_id, week_start_date)
);

CREATE INDEX idx_ad_features_account_week ON ad_weekly_features(ad_account_id, week_start_date);
CREATE INDEX idx_ad_features_ad ON ad_weekly_features(fb_ad_id);

-- 7. АНОМАЛИИ
CREATE TABLE IF NOT EXISTS ad_weekly_anomalies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    fb_ad_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,

    result_family TEXT NOT NULL,
    anomaly_type TEXT NOT NULL,  -- cpr_spike, ctr_drop, freq_high, etc.

    -- Значения
    current_value DECIMAL(12,4),
    baseline_value DECIMAL(12,4),
    delta_pct DECIMAL(8,4),

    -- Скоринг
    anomaly_score DECIMAL(8,4),  -- 0-1, чем выше тем хуже
    confidence DECIMAL(8,4),  -- уверенность (зависит от кол-ва данных)

    -- Триггеры (что могло вызвать аномалию)
    likely_triggers JSONB,  -- [{metric: 'frequency', value: 5.2, delta: '+30%'}]

    -- Статус
    status TEXT DEFAULT 'new',  -- new, acknowledged, resolved, false_positive
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_ad_id, week_start_date, result_family, anomaly_type)
);

CREATE INDEX idx_anomalies_account_week ON ad_weekly_anomalies(ad_account_id, week_start_date);
CREATE INDEX idx_anomalies_status ON ad_weekly_anomalies(status);
CREATE INDEX idx_anomalies_type ON ad_weekly_anomalies(anomaly_type);
CREATE INDEX idx_anomalies_score ON ad_weekly_anomalies(anomaly_score DESC);

-- 8. ЗАДАЧИ СИНХРОНИЗАЦИИ
CREATE TABLE IF NOT EXISTS insights_sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,  -- campaigns, adsets, ads, insights_weekly

    -- Статус
    status TEXT DEFAULT 'pending',  -- pending, running, completed, failed

    -- Для async insights jobs
    fb_report_run_id TEXT,  -- ID отчёта в Facebook

    -- Параметры запроса
    params JSONB,  -- time_range, fields, etc.

    -- Прогресс
    total_items INTEGER,
    processed_items INTEGER DEFAULT 0,
    cursor TEXT,  -- для пагинации

    -- Результат
    result_summary JSONB,  -- {inserted: 100, updated: 50, errors: 2}

    -- Ошибки
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    last_error_at TIMESTAMPTZ,

    -- Время
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sync_jobs_account ON insights_sync_jobs(ad_account_id);
CREATE INDEX idx_sync_jobs_status ON insights_sync_jobs(status);
CREATE INDEX idx_sync_jobs_type ON insights_sync_jobs(job_type);

-- 9. RATE LIMIT STATE
CREATE TABLE IF NOT EXISTS fb_rate_limit_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,

    -- Последние headers от Facebook
    usage_headers JSONB,  -- {call_count, total_cputime, total_time, etc.}

    -- Throttling
    throttle_until TIMESTAMPTZ,  -- не делать запросы до этого времени
    throttle_reason TEXT,

    -- Статистика
    requests_today INTEGER DEFAULT 0,
    last_request_at TIMESTAMPTZ,

    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id)
);

CREATE INDEX idx_rate_limit_throttle ON fb_rate_limit_state(throttle_until);

-- 10. МАППИНГ optimization_goal → result_family
CREATE TABLE IF NOT EXISTS optimization_goal_family_mapping (
    optimization_goal TEXT PRIMARY KEY,
    allowed_families TEXT[] NOT NULL,  -- порядок приоритета
    default_family TEXT NOT NULL
);

-- Заполняем маппинг
INSERT INTO optimization_goal_family_mapping (optimization_goal, allowed_families, default_family) VALUES
    ('LEAD_GENERATION', ARRAY['leadgen_form', 'website_lead'], 'leadgen_form'),
    ('CONVERSATIONS', ARRAY['messages'], 'messages'),
    ('LINK_CLICKS', ARRAY['click'], 'click'),
    ('LANDING_PAGE_VIEWS', ARRAY['click'], 'click'),
    ('VALUE', ARRAY['purchase', 'website_lead'], 'purchase'),
    ('OFFSITE_CONVERSIONS', ARRAY['purchase', 'website_lead', 'leadgen_form'], 'website_lead'),
    ('APP_INSTALLS', ARRAY['app_install'], 'app_install'),
    ('REACH', ARRAY['click'], 'click'),
    ('IMPRESSIONS', ARRAY['click'], 'click'),
    ('THRUPLAY', ARRAY['video_view', 'click'], 'video_view'),
    ('TWO_SECOND_CONTINUOUS_VIDEO_VIEWS', ARRAY['video_view'], 'video_view')
ON CONFLICT (optimization_goal) DO UPDATE SET
    allowed_families = EXCLUDED.allowed_families,
    default_family = EXCLUDED.default_family;

-- 11. МАППИНГ action_type → result_family
CREATE TABLE IF NOT EXISTS action_type_family_mapping (
    action_type TEXT PRIMARY KEY,
    result_family TEXT NOT NULL
);

-- Заполняем маппинг action_types
INSERT INTO action_type_family_mapping (action_type, result_family) VALUES
    -- Messages family
    ('onsite_conversion.messaging_conversation_started_7d', 'messages'),
    ('onsite_conversion.messaging_first_reply', 'messages'),
    ('onsite_conversion.messaging_blocked', 'messages'),
    ('messaging_first_reply', 'messages'),
    ('messaging_conversation_started_7d', 'messages'),

    -- Leadgen form family
    ('lead', 'leadgen_form'),
    ('leadgen_grouped', 'leadgen_form'),
    ('onsite_conversion.lead_grouped', 'leadgen_form'),

    -- Website lead family
    ('offsite_conversion.fb_pixel_lead', 'website_lead'),
    ('offsite_conversion.fb_pixel_complete_registration', 'website_lead'),
    ('offsite_conversion.fb_pixel_submit_application', 'website_lead'),

    -- Purchase family
    ('offsite_conversion.fb_pixel_purchase', 'purchase'),
    ('onsite_conversion.purchase', 'purchase'),
    ('purchase', 'purchase'),

    -- Click family
    ('link_click', 'click'),
    ('landing_page_view', 'click'),
    ('outbound_click', 'click'),

    -- Video family
    ('video_view', 'video_view'),
    ('video_p25_watched_actions', 'video_view'),
    ('video_p50_watched_actions', 'video_view'),
    ('video_p75_watched_actions', 'video_view'),
    ('video_p95_watched_actions', 'video_view'),

    -- App family
    ('app_install', 'app_install'),
    ('mobile_app_install', 'app_install'),
    ('app_custom_event.fb_mobile_activate_app', 'app_install')
ON CONFLICT (action_type) DO UPDATE SET
    result_family = EXCLUDED.result_family;

-- 12. КОНФИГУРАЦИЯ АНОМАЛИЙ
CREATE TABLE IF NOT EXISTS anomaly_detection_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Пороги для детекции
    cpr_spike_threshold DECIMAL(5,2) DEFAULT 1.20,  -- 20% рост = аномалия
    ctr_drop_threshold DECIMAL(5,2) DEFAULT 0.80,   -- 20% падение
    freq_high_threshold DECIMAL(5,2) DEFAULT 1.50,  -- 50% выше baseline

    -- Минимальные результаты для анализа
    min_results_messages INTEGER DEFAULT 5,
    min_results_leads INTEGER DEFAULT 5,
    min_results_purchases INTEGER DEFAULT 3,
    min_results_clicks INTEGER DEFAULT 50,

    -- Baseline окно
    baseline_weeks INTEGER DEFAULT 8,  -- медиана за 8 недель

    -- Веса для anomaly_score
    cpr_weight DECIMAL(3,2) DEFAULT 0.40,
    freq_weight DECIMAL(3,2) DEFAULT 0.25,
    ctr_weight DECIMAL(3,2) DEFAULT 0.20,
    cpc_weight DECIMAL(3,2) DEFAULT 0.15,

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Дефолтная конфигурация
INSERT INTO anomaly_detection_config (id) VALUES (gen_random_uuid())
ON CONFLICT DO NOTHING;

-- 13. ТРИГГЕРЫ ДЛЯ updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_insights_sync_jobs_updated_at
    BEFORE UPDATE ON insights_sync_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fb_rate_limit_state_updated_at
    BEFORE UPDATE ON fb_rate_limit_state
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 14. ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: получить понедельник недели
CREATE OR REPLACE FUNCTION get_week_start(input_date DATE)
RETURNS DATE AS $$
BEGIN
    -- Возвращает понедельник для данной даты
    RETURN input_date - EXTRACT(ISODOW FROM input_date)::INTEGER + 1;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 15. КОММЕНТАРИИ
COMMENT ON TABLE meta_insights_weekly IS 'Weekly ad-level insights from Facebook Marketing API';
COMMENT ON TABLE meta_weekly_results IS 'Normalized results by family (messages, leads, purchases, etc.)';
COMMENT ON TABLE ad_weekly_features IS 'Computed features for anomaly detection with lags and baselines';
COMMENT ON TABLE ad_weekly_anomalies IS 'Detected CPR anomalies and their triggers';
COMMENT ON TABLE optimization_goal_family_mapping IS 'Maps Facebook optimization_goal to result families';
COMMENT ON TABLE action_type_family_mapping IS 'Maps Facebook action_type to result family';
