-- Увеличение лимита рекламных аккаунтов с 5 до 10

CREATE OR REPLACE FUNCTION check_max_ad_accounts()
RETURNS TRIGGER AS $$
DECLARE
  account_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO account_count
  FROM ad_accounts
  WHERE user_account_id = NEW.user_account_id;

  IF account_count >= 10 THEN
    RAISE EXCEPTION 'Maximum 10 advertising accounts allowed per user';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
