-- Migration 143: Add brain schedule settings to ad_accounts
-- Позволяет каждому ad_account иметь свой час запуска и часовой пояс

-- Настройки времени запуска
ALTER TABLE ad_accounts
ADD COLUMN IF NOT EXISTS brain_schedule_hour INTEGER DEFAULT 8
  CHECK (brain_schedule_hour >= 0 AND brain_schedule_hour <= 23);

ALTER TABLE ad_accounts
ADD COLUMN IF NOT EXISTS brain_timezone TEXT DEFAULT 'Asia/Almaty';

-- Для дедупликации (не обрабатывать чаще раз в час)
ALTER TABLE ad_accounts
ADD COLUMN IF NOT EXISTS last_brain_batch_run_at TIMESTAMPTZ;

-- Индекс для быстрого поиска аккаунтов по расписанию
CREATE INDEX IF NOT EXISTS idx_ad_accounts_brain_schedule
ON ad_accounts(brain_schedule_hour, brain_timezone, last_brain_batch_run_at)
WHERE is_active = true;

COMMENT ON COLUMN ad_accounts.brain_schedule_hour IS 'Час запуска Brain (0-23) в локальном часовом поясе';
COMMENT ON COLUMN ad_accounts.brain_timezone IS 'Часовой пояс для расчёта времени запуска (IANA format)';
COMMENT ON COLUMN ad_accounts.last_brain_batch_run_at IS 'Время последнего запуска Brain batch для этого аккаунта';
