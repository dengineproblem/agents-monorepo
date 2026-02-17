-- Динамический лимит рекламных аккаунтов по тарифу
-- Базовый (tarif_renewal_cost < 49000) → до 5 аккаунтов
-- Премиум (tarif_renewal_cost >= 49000) → до 20 аккаунтов

CREATE OR REPLACE FUNCTION check_max_ad_accounts()
RETURNS TRIGGER AS $$
DECLARE
  account_count INTEGER;
  max_allowed INTEGER;
  renewal_cost NUMERIC;
BEGIN
  SELECT COUNT(*) INTO account_count
  FROM ad_accounts
  WHERE user_account_id = NEW.user_account_id;

  SELECT tarif_renewal_cost INTO renewal_cost
  FROM user_accounts
  WHERE id = NEW.user_account_id;

  IF renewal_cost >= 49000 THEN
    max_allowed := 20;
  ELSE
    max_allowed := 5;
  END IF;

  IF account_count >= max_allowed THEN
    RAISE EXCEPTION 'Maximum % advertising accounts allowed for your plan', max_allowed;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
