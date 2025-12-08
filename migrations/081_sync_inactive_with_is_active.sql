-- Migration 081: Sync onboarding_stage='inactive' with is_active flag
-- When is_active changes to false, set onboarding_stage to 'inactive'
-- When is_active changes to true, restore previous stage or set to 'active'

-- Триггерная функция для синхронизации is_active и onboarding_stage
CREATE OR REPLACE FUNCTION sync_onboarding_inactive()
RETURNS TRIGGER AS $$
BEGIN
  -- Если is_active изменился на false и текущий этап не inactive
  IF NEW.is_active = false AND OLD.is_active = true AND NEW.onboarding_stage != 'inactive' THEN
    -- Сохраняем предыдущий этап в onboarding_tags для возможного восстановления
    NEW.onboarding_tags = COALESCE(NEW.onboarding_tags, '[]'::jsonb) ||
      jsonb_build_array('_previous_stage:' || COALESCE(OLD.onboarding_stage, 'registered'));
    NEW.onboarding_stage = 'inactive';

    -- Логируем изменение в историю
    INSERT INTO onboarding_history (user_account_id, stage_from, stage_to, change_reason)
    VALUES (NEW.id, OLD.onboarding_stage, 'inactive', 'Автоматически: is_active=false');
  END IF;

  -- Если is_active изменился на true и текущий этап inactive
  IF NEW.is_active = true AND OLD.is_active = false AND NEW.onboarding_stage = 'inactive' THEN
    -- Пробуем восстановить предыдущий этап из тегов
    DECLARE
      prev_stage TEXT := 'active';
      tag TEXT;
    BEGIN
      -- Ищем тег с предыдущим этапом
      FOR tag IN SELECT jsonb_array_elements_text(NEW.onboarding_tags)
      LOOP
        IF tag LIKE '_previous_stage:%' THEN
          prev_stage := substring(tag from 17);
          -- Удаляем служебный тег
          NEW.onboarding_tags = NEW.onboarding_tags - tag;
          EXIT;
        END IF;
      END LOOP;

      NEW.onboarding_stage = prev_stage;

      -- Логируем изменение в историю
      INSERT INTO onboarding_history (user_account_id, stage_from, stage_to, change_reason)
      VALUES (NEW.id, 'inactive', prev_stage, 'Автоматически: is_active=true');
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Создаём триггер
DROP TRIGGER IF EXISTS trigger_sync_onboarding_inactive ON user_accounts;
CREATE TRIGGER trigger_sync_onboarding_inactive
  BEFORE UPDATE ON user_accounts
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION sync_onboarding_inactive();

-- Комментарий
COMMENT ON FUNCTION sync_onboarding_inactive() IS
  'Синхронизирует onboarding_stage с is_active:
   - is_active=false → onboarding_stage=inactive (сохраняет предыдущий этап в тегах)
   - is_active=true → восстанавливает предыдущий этап или ставит active';
