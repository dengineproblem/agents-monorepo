-- Добавить колонку для отслеживания статуса приглашения в закрытый канал комьюнити
ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS community_channel_invited boolean DEFAULT false;
