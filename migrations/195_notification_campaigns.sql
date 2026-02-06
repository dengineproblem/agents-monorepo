-- Migration 195: notification campaigns
-- Created: 2026-02-06
-- Description: Планировщик регулярных/одноразовых рассылок уведомлений для админки

CREATE TABLE IF NOT EXISTS notification_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type VARCHAR(80) NOT NULL DEFAULT 'admin_broadcast',
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  telegram_message TEXT,
  cta_url TEXT,
  cta_label TEXT,
  channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
  segment VARCHAR(40) NOT NULL DEFAULT 'all_active',
  user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  only_with_telegram BOOLEAN NOT NULL DEFAULT false,
  schedule_mode VARCHAR(20) NOT NULL DEFAULT 'once'
    CHECK (schedule_mode IN ('once', 'daily', 'weekly')),
  scheduled_at TIMESTAMPTZ,
  send_hour_utc INTEGER CHECK (send_hour_utc BETWEEN 0 AND 23),
  send_minute_utc INTEGER NOT NULL DEFAULT 0 CHECK (send_minute_utc BETWEEN 0 AND 59),
  weekly_day INTEGER CHECK (weekly_day BETWEEN 0 AND 6),
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_admin_id UUID REFERENCES user_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_campaigns_active_next
  ON notification_campaigns(is_active, next_run_at)
  WHERE is_active = true AND next_run_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_campaigns_created
  ON notification_campaigns(created_at DESC);

ALTER TABLE notification_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to notification_campaigns" ON notification_campaigns;
CREATE POLICY "Service role full access to notification_campaigns"
ON notification_campaigns
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE notification_campaigns IS 'Запланированные рассылки уведомлений (одноразовые/регулярные)';
COMMENT ON COLUMN notification_campaigns.schedule_mode IS 'once|daily|weekly';
COMMENT ON COLUMN notification_campaigns.segment IS 'all|all_active|subscription_active|with_telegram|without_subscription|subscription_expiring_7d|custom';
