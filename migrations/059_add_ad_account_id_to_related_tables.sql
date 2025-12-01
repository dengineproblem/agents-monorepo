-- Migration 059: Add ad_account_id to directions, leads, and creatives tables
-- Links business data to specific advertising accounts
-- SAFE: Only adds nullable columns, no breaking changes

-- 1. account_directions - направления рекламы
ALTER TABLE account_directions
ADD COLUMN ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE CASCADE;

CREATE INDEX idx_account_directions_ad_account_id
  ON account_directions(ad_account_id);

COMMENT ON COLUMN account_directions.ad_account_id IS
  'Привязка направления к рекламному аккаунту (для мультиаккаунтности). NULL = legacy режим.';

-- 2. leads - лиды
ALTER TABLE leads
ADD COLUMN ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_leads_ad_account_id
  ON leads(ad_account_id);

COMMENT ON COLUMN leads.ad_account_id IS
  'Привязка лида к рекламному аккаунту (для мультиаккаунтности). NULL = legacy режим.';

-- 3. user_creatives - загруженные пользователем креативы
ALTER TABLE user_creatives
ADD COLUMN ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_user_creatives_ad_account_id
  ON user_creatives(ad_account_id);

COMMENT ON COLUMN user_creatives.ad_account_id IS
  'Привязка креатива к рекламному аккаунту (для мультиаккаунтности). NULL = legacy режим.';

-- 4. generated_creatives - сгенерированные креативы
ALTER TABLE generated_creatives
ADD COLUMN ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_generated_creatives_ad_account_id
  ON generated_creatives(ad_account_id);

COMMENT ON COLUMN generated_creatives.ad_account_id IS
  'Привязка сгенерированного креатива к рекламному аккаунту (для мультиаккаунтности). NULL = legacy режим.';
