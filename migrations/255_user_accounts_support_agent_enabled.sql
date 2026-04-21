-- migrations/255_user_accounts_support_agent_enabled.sql
ALTER TABLE user_accounts
  ADD COLUMN support_agent_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_accounts.support_agent_enabled IS
  'Фиче-флаг: включает домен support в AI-чате для этого юзера';
