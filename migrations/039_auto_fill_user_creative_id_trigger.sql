-- Автоматическое заполнение user_creative_id в creative_metrics_history
-- На основе ad_id из ad_creative_mapping

-- Функция для автоматического заполнения user_creative_id
CREATE OR REPLACE FUNCTION auto_fill_user_creative_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Если user_creative_id уже заполнен, ничего не делаем
  IF NEW.user_creative_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Ищем user_creative_id через ad_id в ad_creative_mapping
  IF NEW.ad_id IS NOT NULL THEN
    SELECT user_creative_id INTO NEW.user_creative_id
    FROM ad_creative_mapping
    WHERE ad_id = NEW.ad_id
    LIMIT 1;
  END IF;

  -- Если не нашли через ad_id, пробуем через creative_id (fb_creative_id)
  IF NEW.user_creative_id IS NULL AND NEW.creative_id IS NOT NULL THEN
    SELECT user_creative_id INTO NEW.user_creative_id
    FROM ad_creative_mapping
    WHERE fb_creative_id = NEW.creative_id
      AND user_id = NEW.user_account_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер срабатывает ПЕРЕД вставкой/обновлением
CREATE TRIGGER trigger_auto_fill_user_creative_id
  BEFORE INSERT OR UPDATE ON creative_metrics_history
  FOR EACH ROW
  EXECUTE FUNCTION auto_fill_user_creative_id();

COMMENT ON FUNCTION auto_fill_user_creative_id() IS 
'Автоматически заполняет user_creative_id на основе ad_id через ad_creative_mapping';


