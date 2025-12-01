-- Migration 062: Add autopilot and optimization settings to ad_accounts
-- Each ad account has its own autopilot/optimization configuration
-- SAFE: Only adds nullable columns

-- 1. Add autopilot settings
ALTER TABLE ad_accounts
ADD COLUMN autopilot BOOLEAN DEFAULT FALSE,
ADD COLUMN optimization BOOLEAN DEFAULT FALSE,
ADD COLUMN plan_daily_budget_cents INTEGER,
ADD COLUMN default_cpl_target_cents INTEGER;

-- 2. Indexes for autopilot queries
CREATE INDEX idx_ad_accounts_autopilot ON ad_accounts(user_account_id) WHERE autopilot = true;

COMMENT ON COLUMN ad_accounts.autopilot IS 'Включён ли автопилот для этого аккаунта';
COMMENT ON COLUMN ad_accounts.optimization IS 'Включена ли оптимизация для этого аккаунта';
COMMENT ON COLUMN ad_accounts.plan_daily_budget_cents IS 'Плановый дневной бюджет в центах';
COMMENT ON COLUMN ad_accounts.default_cpl_target_cents IS 'Целевая стоимость лида в центах';
