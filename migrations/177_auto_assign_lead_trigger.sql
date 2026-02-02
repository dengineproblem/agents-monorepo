-- Migration: Auto-assign lead to consultant on INSERT
-- Описание: Создать триггер для автоматического распределения новых лидов на консультантов
-- Дата: 2026-02-01

-- Функция для триггера
CREATE OR REPLACE FUNCTION auto_assign_lead_on_insert()
RETURNS TRIGGER AS $$
DECLARE
    assigned_consultant UUID;
BEGIN
    -- Если лид уже назначен на консультанта - не трогаем
    IF NEW.assigned_consultant_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Если нет user_account_id - не можем распределить
    IF NEW.user_account_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Вызываем функцию распределения
    assigned_consultant := assign_lead_to_consultant(NEW.user_account_id);

    -- Если нашли консультанта - назначаем
    IF assigned_consultant IS NOT NULL THEN
        NEW.assigned_consultant_id := assigned_consultant;

        -- Логируем в таблицу (опционально, для отладки)
        -- RAISE NOTICE 'Auto-assigned lead % to consultant %', NEW.id, assigned_consultant;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Создать триггер на INSERT
DROP TRIGGER IF EXISTS trigger_auto_assign_lead ON dialog_analysis;

CREATE TRIGGER trigger_auto_assign_lead
    BEFORE INSERT ON dialog_analysis
    FOR EACH ROW
    EXECUTE FUNCTION auto_assign_lead_on_insert();

-- Комментарии
COMMENT ON FUNCTION auto_assign_lead_on_insert() IS 'Автоматически назначает нового лида на консультанта при создании записи в dialog_analysis';
COMMENT ON TRIGGER trigger_auto_assign_lead ON dialog_analysis IS 'Триггер для автоматического распределения новых лидов между консультантами';
