-- Миграция: Логика лимитов бюджета
-- Дата: 2025-10-11
-- Описание: Общий бюджет user_accounts ограничивает сумму бюджетов направлений

-- =====================================================
-- 1. Обновляем комментарии к колонкам
-- =====================================================
COMMENT ON COLUMN user_accounts.daily_budget_cents IS 'МАКСИМАЛЬНЫЙ суточный бюджет для всех направлений вместе (в центах)';
COMMENT ON COLUMN user_accounts.target_cpl_cents IS 'Целевая стоимость лида по умолчанию (используется как дефолт для новых направлений)';

-- =====================================================
-- 2. Функция проверки общего лимита бюджета
-- =====================================================
CREATE OR REPLACE FUNCTION check_total_budget_limit()
RETURNS TRIGGER AS $$
DECLARE
  total_budget INTEGER;
  account_limit INTEGER;
  available_budget INTEGER;
BEGIN
  -- Суммируем бюджеты всех активных направлений (кроме текущего)
  SELECT COALESCE(SUM(daily_budget_cents), 0) INTO total_budget
  FROM account_directions
  WHERE user_account_id = NEW.user_account_id
    AND is_active = true
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  
  -- Получаем лимит аккаунта (если не установлен, ставим большое значение)
  SELECT COALESCE(daily_budget_cents, 999999999) INTO account_limit
  FROM user_accounts
  WHERE id = NEW.user_account_id;
  
  -- Считаем доступный бюджет
  available_budget := account_limit - total_budget;
  
  -- Проверяем только если направление активно
  IF NEW.is_active = true THEN
    IF NEW.daily_budget_cents > available_budget THEN
      RAISE EXCEPTION 'Превышен лимит бюджета аккаунта! Доступно: $%, Запрошено: $%. Увеличьте общий бюджет или уменьшите бюджет других направлений.',
        ROUND(available_budget / 100.0, 2),
        ROUND(NEW.daily_budget_cents / 100.0, 2);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Удаляем старый триггер если есть
DROP TRIGGER IF EXISTS trigger_check_budget_limit ON account_directions;

-- Создаём триггер для проверки лимита
CREATE TRIGGER trigger_check_budget_limit
BEFORE INSERT OR UPDATE ON account_directions
FOR EACH ROW
EXECUTE FUNCTION check_total_budget_limit();

-- =====================================================
-- 3. Функция для получения доступного бюджета
-- =====================================================
CREATE OR REPLACE FUNCTION get_available_budget(p_user_account_id UUID)
RETURNS TABLE(
  total_limit_cents INTEGER,
  used_budget_cents INTEGER,
  available_budget_cents INTEGER,
  active_directions_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(ua.daily_budget_cents, 999999999) as total_limit_cents,
    COALESCE(SUM(ad.daily_budget_cents) FILTER (WHERE ad.is_active = true), 0)::INTEGER as used_budget_cents,
    (COALESCE(ua.daily_budget_cents, 999999999) - COALESCE(SUM(ad.daily_budget_cents) FILTER (WHERE ad.is_active = true), 0))::INTEGER as available_budget_cents,
    COUNT(ad.id) FILTER (WHERE ad.is_active = true)::INTEGER as active_directions_count
  FROM user_accounts ua
  LEFT JOIN account_directions ad ON ad.user_account_id = ua.id
  WHERE ua.id = p_user_account_id
  GROUP BY ua.id, ua.daily_budget_cents;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Комментарий к функции
COMMENT ON FUNCTION get_available_budget(UUID) IS 'Возвращает информацию о доступном бюджете для пользователя: общий лимит, использованный бюджет, доступный остаток';

-- =====================================================
-- 4. View для удобного просмотра распределения бюджета
-- =====================================================
CREATE OR REPLACE VIEW v_budget_allocation AS
SELECT 
  ua.id as user_account_id,
  ua.instagram_username,
  ua.daily_budget_cents as total_budget_cents,
  COALESCE(SUM(ad.daily_budget_cents) FILTER (WHERE ad.is_active = true), 0)::INTEGER as used_budget_cents,
  (ua.daily_budget_cents - COALESCE(SUM(ad.daily_budget_cents) FILTER (WHERE ad.is_active = true), 0))::INTEGER as available_budget_cents,
  ROUND(
    CASE 
      WHEN ua.daily_budget_cents > 0 
      THEN (COALESCE(SUM(ad.daily_budget_cents) FILTER (WHERE ad.is_active = true), 0) * 100.0 / ua.daily_budget_cents)
      ELSE 0 
    END, 
    2
  ) as budget_utilization_percent,
  COUNT(ad.id) FILTER (WHERE ad.is_active = true) as active_directions_count,
  COUNT(ad.id) as total_directions_count
FROM user_accounts ua
LEFT JOIN account_directions ad ON ad.user_account_id = ua.id
GROUP BY ua.id, ua.instagram_username, ua.daily_budget_cents;

COMMENT ON VIEW v_budget_allocation IS 'Показывает распределение бюджета по направлениям для каждого пользователя';

-- =====================================================
-- 5. Grants
-- =====================================================
GRANT EXECUTE ON FUNCTION get_available_budget(UUID) TO service_role;
GRANT SELECT ON v_budget_allocation TO service_role;

-- =====================================================
-- 6. Пример использования
-- =====================================================
-- Получить доступный бюджет для пользователя:
-- SELECT * FROM get_available_budget('user-uuid-here');

-- Посмотреть распределение бюджета:
-- SELECT * FROM v_budget_allocation WHERE user_account_id = 'user-uuid-here';

