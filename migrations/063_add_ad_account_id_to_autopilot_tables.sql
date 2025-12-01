-- Migration 063: Add ad_account_id to brain_executions and campaign_reports
-- For multi-account support - each account has its own autopilot history
-- SAFE: Only adds nullable columns and indexes

-- 1. Add ad_account_id to brain_executions
ALTER TABLE brain_executions
ADD COLUMN ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE CASCADE;

CREATE INDEX idx_brain_executions_ad_account_id ON brain_executions(ad_account_id);

COMMENT ON COLUMN brain_executions.ad_account_id IS 'Привязка к рекламному аккаунту (для мультиаккаунтности). NULL = legacy режим.';

-- 2. Add ad_account_id to campaign_reports
ALTER TABLE campaign_reports
ADD COLUMN ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE CASCADE;

CREATE INDEX idx_campaign_reports_ad_account_id ON campaign_reports(ad_account_id);

COMMENT ON COLUMN campaign_reports.ad_account_id IS 'Привязка к рекламному аккаунту (для мультиаккаунтности). NULL = legacy режим.';
