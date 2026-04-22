-- ============================================================================
-- INCREASE DIRECTIONS LIMIT FROM 10 TO 20
-- ============================================================================

CREATE OR REPLACE FUNCTION check_max_directions_per_user()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_active = true) OR
     (TG_OP = 'UPDATE' AND OLD.is_active = false AND NEW.is_active = true) THEN

    SELECT COUNT(*) INTO active_count
    FROM account_directions
    WHERE user_account_id = NEW.user_account_id
      AND is_active = true
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF active_count >= 20 THEN
      RAISE EXCEPTION 'Maximum 20 active directions per user. Current active: %', active_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_max_directions_per_user() IS 'Проверка лимита активных направлений (макс. 20)';
