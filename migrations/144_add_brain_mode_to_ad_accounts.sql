-- Migration 144: Add brain_mode enum to ad_accounts
-- Три режима: autopilot (авто), semi_auto (требует одобрения), report (только отчёты)

-- Добавляем новое поле brain_mode
ALTER TABLE ad_accounts
ADD COLUMN IF NOT EXISTS brain_mode TEXT DEFAULT 'report'
  CHECK (brain_mode IN ('autopilot', 'report', 'semi_auto'));

-- Миграция данных: autopilot=true → 'autopilot', иначе 'report'
UPDATE ad_accounts
SET brain_mode = CASE
  WHEN autopilot = true THEN 'autopilot'
  ELSE 'report'
END
WHERE brain_mode IS NULL OR brain_mode = 'report';

-- Индекс для фильтрации по режиму
CREATE INDEX IF NOT EXISTS idx_ad_accounts_brain_mode
ON ad_accounts(user_account_id, brain_mode)
WHERE brain_mode IN ('autopilot', 'semi_auto') AND is_active = true;

COMMENT ON COLUMN ad_accounts.brain_mode IS 'Режим Brain: autopilot (авто), semi_auto (требует одобрения), report (только отчёты)';
