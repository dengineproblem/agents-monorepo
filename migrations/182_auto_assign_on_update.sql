-- =============================================
-- Migration 182: Auto-assign consultant on UPDATE (repeat messages)
-- Описание: Добавить триггер на UPDATE dialog_analysis для распределения
--           лидов которые пишут повторно (старые лиды без консультанта)
-- Дата: 2026-02-02
-- =============================================

-- Функция для триггера на UPDATE
CREATE OR REPLACE FUNCTION auto_assign_lead_on_update()
RETURNS TRIGGER AS $$
DECLARE
    assigned_consultant UUID;
BEGIN
    -- Срабатывает только если:
    -- 1. У лида ДО СИХ ПОР нет назначенного консультанта
    -- 2. last_message обновился (пришло новое сообщение от клиента)
    -- 3. user_account_id установлен

    -- Если консультант уже назначен - ничего не делаем
    IF NEW.assigned_consultant_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Если консультант не был назначен и остаётся не назначенным
    IF OLD.assigned_consultant_id IS NULL AND NEW.assigned_consultant_id IS NULL THEN

        -- Проверяем что это повторное сообщение (last_message обновился)
        -- ИЛИ incoming_count увеличился (пришло новое сообщение)
        IF (NEW.last_message IS DISTINCT FROM OLD.last_message) OR
           (NEW.incoming_count > OLD.incoming_count) THEN

            -- Если нет user_account_id - не можем распределить
            IF NEW.user_account_id IS NULL THEN
                RETURN NEW;
            END IF;

            -- Вызываем функцию распределения
            assigned_consultant := assign_lead_to_consultant(NEW.user_account_id);

            -- Если нашли консультанта - назначаем
            IF assigned_consultant IS NOT NULL THEN
                NEW.assigned_consultant_id := assigned_consultant;

                -- Логируем (опционально)
                RAISE NOTICE 'Auto-assigned repeat lead % (phone: %) to consultant %',
                    NEW.id, NEW.contact_phone, assigned_consultant;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Создать триггер на UPDATE
DROP TRIGGER IF EXISTS trigger_auto_assign_lead_on_update ON dialog_analysis;

CREATE TRIGGER trigger_auto_assign_lead_on_update
    BEFORE UPDATE ON dialog_analysis
    FOR EACH ROW
    EXECUTE FUNCTION auto_assign_lead_on_update();

-- Комментарии
COMMENT ON FUNCTION auto_assign_lead_on_update() IS
'Автоматически назначает консультанта старым лидам когда они пишут повторно (UPDATE с новым сообщением)';

COMMENT ON TRIGGER trigger_auto_assign_lead_on_update ON dialog_analysis IS
'Триггер для автоматического распределения лидов при повторном обращении (UPDATE)';

-- =============================================
-- ТЕСТИРОВАНИЕ
-- =============================================

DO $$
DECLARE
    v_test_lead_id UUID;
    v_test_user_account_id UUID;
    v_assigned_consultant_id UUID;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Тест триггера auto_assign_lead_on_update';
    RAISE NOTICE '========================================';

    -- Найти тестовый лид без консультанта
    SELECT id, user_account_id INTO v_test_lead_id, v_test_user_account_id
    FROM dialog_analysis
    WHERE assigned_consultant_id IS NULL
      AND user_account_id IS NOT NULL
      AND contact_phone IS NOT NULL
    LIMIT 1;

    IF v_test_lead_id IS NULL THEN
        RAISE NOTICE '⚠️ Нет лидов для тестирования (все лиды распределены или без user_account_id)';
    ELSE
        -- Проверить что для этого user_account_id есть доступные консультанты
        IF EXISTS (
            SELECT 1 FROM consultants
            WHERE parent_user_account_id = v_test_user_account_id
              AND is_active = true
              AND accepts_new_leads = true
        ) THEN
            RAISE NOTICE '✅ Найден тестовый лид: % (user_account_id: %)', v_test_lead_id, v_test_user_account_id;
            RAISE NOTICE 'Имитируем повторное сообщение...';

            -- Обновить last_message (имитация нового сообщения)
            UPDATE dialog_analysis
            SET last_message = NOW()
            WHERE id = v_test_lead_id
            RETURNING assigned_consultant_id INTO v_assigned_consultant_id;

            IF v_assigned_consultant_id IS NOT NULL THEN
                RAISE NOTICE '✅ УСПЕХ! Консультант назначен: %', v_assigned_consultant_id;
            ELSE
                RAISE WARNING '❌ ОШИБКА: Консультант НЕ назначен (проверьте логи)';
            END IF;
        ELSE
            RAISE NOTICE '⚠️ Для user_account_id % нет доступных консультантов', v_test_user_account_id;
        END IF;
    END IF;

    RAISE NOTICE '========================================';
END$$;

-- =============================================
-- ИТОГОВЫЙ ОТЧЁТ
-- =============================================

DO $$
DECLARE
    v_unassigned_with_account INTEGER;
    v_has_consultants INTEGER;
BEGIN
    -- Считаем лидов без консультанта но с user_account_id
    SELECT COUNT(*) INTO v_unassigned_with_account
    FROM dialog_analysis
    WHERE assigned_consultant_id IS NULL
      AND user_account_id IS NOT NULL;

    -- Считаем у скольких из них есть доступные консультанты
    SELECT COUNT(DISTINCT da.id) INTO v_has_consultants
    FROM dialog_analysis da
    WHERE da.assigned_consultant_id IS NULL
      AND da.user_account_id IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM consultants c
          WHERE c.parent_user_account_id = da.user_account_id
            AND c.is_active = true
            AND c.accepts_new_leads = true
      );

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Миграция 182 успешно применена';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Изменения:';
    RAISE NOTICE '1. Добавлена функция auto_assign_lead_on_update()';
    RAISE NOTICE '2. Создан триггер trigger_auto_assign_lead_on_update';
    RAISE NOTICE '';
    RAISE NOTICE 'Статистика:';
    RAISE NOTICE '- Лидов без консультанта (с user_account_id): %', v_unassigned_with_account;
    RAISE NOTICE '- Из них могут быть распределены при повторном обращении: %', v_has_consultants;
    RAISE NOTICE '';
    RAISE NOTICE '💡 ЛОГИКА:';
    RAISE NOTICE 'Старые лиды НЕ распределяются массово.';
    RAISE NOTICE 'Когда старый лид пишет ПОВТОРНО (UPDATE с новым сообщением) -';
    RAISE NOTICE 'триггер автоматически назначит консультанта.';
    RAISE NOTICE '';
    RAISE NOTICE 'Условия срабатывания триггера:';
    RAISE NOTICE '  1. assigned_consultant_id = NULL (консультант не назначен)';
    RAISE NOTICE '  2. last_message изменился ИЛИ incoming_count увеличился';
    RAISE NOTICE '  3. user_account_id IS NOT NULL';
    RAISE NOTICE '  4. Есть доступные консультанты (is_active=true, accepts_new_leads=true)';
    RAISE NOTICE '========================================';
END$$;
