-- Migration: Direction Metrics Rollup
-- Rollup метрик по направлениям (бизнес-сущности)
-- Заполняется после saveCreativeMetricsToHistory() в scoring.js

-- Таблица rollup
CREATE TABLE IF NOT EXISTS direction_metrics_rollup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL,
  account_id UUID,  -- для мультиаккаунтности (NULL = legacy)
  direction_id UUID NOT NULL REFERENCES account_directions(id) ON DELETE CASCADE,

  day DATE NOT NULL,

  -- Метрики за день
  spend NUMERIC DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  leads BIGINT DEFAULT 0,

  cpl NUMERIC,
  ctr NUMERIC,
  cpm NUMERIC,

  -- Креативы
  active_creatives_count INTEGER DEFAULT 0,
  active_ads_count INTEGER DEFAULT 0,

  -- Delta vs yesterday
  spend_delta NUMERIC,
  leads_delta INTEGER,
  cpl_delta NUMERIC,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Уникальный constraint (с учётом NULL account_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_direction_metrics_rollup_unique
ON direction_metrics_rollup (user_account_id, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), direction_id, day);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_direction_metrics_rollup_lookup
ON direction_metrics_rollup (user_account_id, account_id, day DESC);

CREATE INDEX IF NOT EXISTS idx_direction_metrics_rollup_direction
ON direction_metrics_rollup (direction_id, day DESC);

-- Функция upsert rollup
CREATE OR REPLACE FUNCTION upsert_direction_metrics_rollup(
  p_user_account_id UUID,
  p_account_id UUID,
  p_day DATE DEFAULT CURRENT_DATE - INTERVAL '1 day'
)
RETURNS INTEGER AS $$
DECLARE
  v_yesterday DATE := p_day - INTERVAL '1 day';
  v_rows_affected INTEGER := 0;
BEGIN
  -- Вставить/обновить метрики по направлениям
  INSERT INTO direction_metrics_rollup (
    user_account_id, account_id, direction_id, day,
    spend, impressions, clicks, leads, cpl, ctr, cpm,
    active_creatives_count, active_ads_count,
    updated_at
  )
  SELECT
    cmh.user_account_id,
    cmh.account_id,
    acm.direction_id,
    cmh.date as day,

    COALESCE(SUM(cmh.spend), 0) as spend,
    COALESCE(SUM(cmh.impressions), 0) as impressions,
    COALESCE(SUM(cmh.clicks), 0) as clicks,
    COALESCE(SUM(cmh.leads), 0) as leads,

    CASE WHEN SUM(cmh.leads) > 0
         THEN ROUND(SUM(cmh.spend) / SUM(cmh.leads), 2)
         ELSE NULL END as cpl,
    CASE WHEN SUM(cmh.impressions) > 0
         THEN ROUND(SUM(cmh.clicks)::NUMERIC / SUM(cmh.impressions) * 100, 2)
         ELSE NULL END as ctr,
    CASE WHEN SUM(cmh.impressions) > 0
         THEN ROUND(SUM(cmh.spend) * 1000 / SUM(cmh.impressions), 2)
         ELSE NULL END as cpm,

    COUNT(DISTINCT cmh.user_creative_id) as active_creatives_count,
    COUNT(DISTINCT cmh.ad_id) as active_ads_count,

    now()

  FROM creative_metrics_history cmh
  JOIN ad_creative_mapping acm ON acm.ad_id = cmh.ad_id
  WHERE cmh.user_account_id = p_user_account_id
    AND (
      (p_account_id IS NULL AND cmh.account_id IS NULL)
      OR cmh.account_id = p_account_id
    )
    AND cmh.date = p_day
    AND cmh.source = 'production'
    AND acm.direction_id IS NOT NULL
  GROUP BY cmh.user_account_id, cmh.account_id, acm.direction_id, cmh.date

  ON CONFLICT (user_account_id, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), direction_id, day)
  DO UPDATE SET
    spend = EXCLUDED.spend,
    impressions = EXCLUDED.impressions,
    clicks = EXCLUDED.clicks,
    leads = EXCLUDED.leads,
    cpl = EXCLUDED.cpl,
    ctr = EXCLUDED.ctr,
    cpm = EXCLUDED.cpm,
    active_creatives_count = EXCLUDED.active_creatives_count,
    active_ads_count = EXCLUDED.active_ads_count,
    updated_at = now();

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- Обновить deltas (сравнение с вчера)
  UPDATE direction_metrics_rollup dmr
  SET
    spend_delta = dmr.spend - COALESCE(yday.spend, 0),
    leads_delta = dmr.leads::INTEGER - COALESCE(yday.leads, 0)::INTEGER,
    cpl_delta = CASE
      WHEN dmr.cpl IS NOT NULL AND yday.cpl IS NOT NULL
      THEN ROUND(dmr.cpl - yday.cpl, 2)
      ELSE NULL
    END
  FROM direction_metrics_rollup yday
  WHERE dmr.user_account_id = p_user_account_id
    AND dmr.day = p_day
    AND yday.user_account_id = dmr.user_account_id
    AND yday.direction_id = dmr.direction_id
    AND yday.day = v_yesterday
    AND (
      (dmr.account_id IS NULL AND yday.account_id IS NULL)
      OR dmr.account_id = yday.account_id
    );

  RETURN v_rows_affected;
END;
$$ LANGUAGE plpgsql;

-- Комментарии
COMMENT ON TABLE direction_metrics_rollup IS 'Daily rollup метрик по направлениям. Заполняется после saveCreativeMetricsToHistory()';
COMMENT ON FUNCTION upsert_direction_metrics_rollup IS 'Upsert rollup из creative_metrics_history через ad_creative_mapping';
