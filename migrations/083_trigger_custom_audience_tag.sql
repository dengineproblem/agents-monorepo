-- =====================================================
-- Migration 083: Trigger for added_custom_audience tag
-- =====================================================
-- Автоматически добавляет тег при установке ig_seed_audience_id
-- =====================================================

CREATE OR REPLACE FUNCTION add_custom_audience_tag()
RETURNS TRIGGER AS $$
BEGIN
  -- Срабатывает когда ig_seed_audience_id изменился с NULL на значение
  IF NEW.ig_seed_audience_id IS NOT NULL
     AND (OLD.ig_seed_audience_id IS NULL OR OLD.ig_seed_audience_id IS DISTINCT FROM NEW.ig_seed_audience_id)
     AND NEW.is_tech_admin = false
     AND NOT (COALESCE(NEW.onboarding_tags, '[]'::jsonb) @> '["added_custom_audience"]'::jsonb)
  THEN
    NEW.onboarding_tags = COALESCE(NEW.onboarding_tags, '[]'::jsonb) || '["added_custom_audience"]'::jsonb;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Удаляем старый триггер если есть
DROP TRIGGER IF EXISTS trigger_add_custom_audience_tag ON user_accounts;

-- Создаём триггер
CREATE TRIGGER trigger_add_custom_audience_tag
BEFORE UPDATE ON user_accounts
FOR EACH ROW
EXECUTE FUNCTION add_custom_audience_tag();

COMMENT ON FUNCTION add_custom_audience_tag() IS 'Добавляет тег added_custom_audience при установке ig_seed_audience_id';
