-- OpenClaw Pairing: связь OpenClaw контейнеров с SaaS аккаунтами
-- user_accounts получают метку is_openclaw + slug для маршрутизации

ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS is_openclaw BOOLEAN DEFAULT false;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS openclaw_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_openclaw_slug
  ON user_accounts(openclaw_slug) WHERE openclaw_slug IS NOT NULL;
