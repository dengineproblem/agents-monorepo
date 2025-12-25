-- ============================================================================
-- INCREASE DIRECTIONS LIMIT FROM 5 TO 10
-- ============================================================================

CREATE OR REPLACE FUNCTION check_max_directions_per_user()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  -- Проверяем только при активации направления
  IF NEW.is_active = true THEN
    SELECT COUNT(*) INTO active_count
    FROM account_directions
    WHERE user_account_id = NEW.user_account_id
      AND is_active = true
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF active_count >= 10 THEN
      RAISE EXCEPTION 'Maximum 10 active directions per user. Current active: %', active_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_max_directions_per_user() IS 'Проверка лимита активных направлений (макс. 10)';
