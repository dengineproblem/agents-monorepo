-- Migration 115: Daily Insights для детекции пауз
--
-- Добавляет:
-- 1. Таблицу meta_insights_daily для ежедневных данных
-- 2. Поля pause_days_count и has_delivery_gap в ad_weekly_anomalies
--
-- Логика детекции пауз:
-- Если в течение недели есть дни с impressions = 0 при наличии spend в другие дни,
-- это указывает на паузу (неоплата, модерация, лимиты и т.д.)

-- ============================================================================
-- 1. Таблица для ежедневных insights
-- ============================================================================

CREATE TABLE IF NOT EXISTS meta_insights_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_account_id UUID NOT NULL,
    fb_ad_id TEXT NOT NULL,
    date DATE NOT NULL,

    -- Основные метрики
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    spend DECIMAL(12,2) DEFAULT 0,
    reach INTEGER DEFAULT 0,

    -- Вычисляемые
    ctr DECIMAL(6,4),
    cpm DECIMAL(10,4),
    cpc DECIMAL(10,4),

    -- Результаты (из actions_json)
    results_count INTEGER DEFAULT 0,

    -- Метаданные
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_account_id, fb_ad_id, date)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_daily_insights_account_date
ON meta_insights_daily(ad_account_id, date);

CREATE INDEX IF NOT EXISTS idx_daily_insights_ad_date
ON meta_insights_daily(fb_ad_id, date);

-- ============================================================================
-- 2. Поля для детекции пауз в ad_weekly_anomalies
-- ============================================================================

-- Количество дней с нулевыми impressions в неделе аномалии
ALTER TABLE ad_weekly_anomalies
ADD COLUMN IF NOT EXISTS pause_days_count INTEGER DEFAULT 0;

-- Флаг: была ли значительная пауза в доставке
ALTER TABLE ad_weekly_anomalies
ADD COLUMN IF NOT EXISTS has_delivery_gap BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- 3. Поля для детекции пауз в ad_weekly_features
-- ============================================================================

-- Количество дней с impressions > 0 за неделю (из 7)
ALTER TABLE ad_weekly_features
ADD COLUMN IF NOT EXISTS active_days INTEGER;

-- Минимальные impressions за день в неделе
ALTER TABLE ad_weekly_features
ADD COLUMN IF NOT EXISTS min_daily_impressions INTEGER;

-- Максимальные impressions за день в неделе
ALTER TABLE ad_weekly_features
ADD COLUMN IF NOT EXISTS max_daily_impressions INTEGER;

-- Коэффициент вариации daily impressions (std/mean)
ALTER TABLE ad_weekly_features
ADD COLUMN IF NOT EXISTS daily_impressions_cv DECIMAL(6,4);

-- ============================================================================
-- 4. Комментарии
-- ============================================================================

COMMENT ON TABLE meta_insights_daily IS 'Ежедневные insights для детекции пауз в доставке';
COMMENT ON COLUMN ad_weekly_anomalies.pause_days_count IS 'Количество дней с нулевыми impressions в неделе';
COMMENT ON COLUMN ad_weekly_anomalies.has_delivery_gap IS 'Флаг наличия значительной паузы в доставке';
COMMENT ON COLUMN ad_weekly_features.active_days IS 'Количество дней с impressions > 0 (из 7)';
COMMENT ON COLUMN ad_weekly_features.daily_impressions_cv IS 'Коэффициент вариации daily impressions';
