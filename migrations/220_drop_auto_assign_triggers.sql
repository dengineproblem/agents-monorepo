-- =============================================
-- Миграция 220: Удаление триггеров автораспределения лидов
-- Описание: Логика назначения консультантов перенесена в код chatbot-service
--           с привязкой к конкретному боту (consultant_ids из ai_bot_configurations)
-- Дата: 2026-02-18
-- =============================================

-- Удаляем триггер на INSERT (назначение при создании лида)
DROP TRIGGER IF EXISTS trigger_auto_assign_lead ON dialog_analysis;

-- Удаляем триггер на UPDATE (назначение при повторном сообщении старого лида)
DROP TRIGGER IF EXISTS trigger_auto_assign_lead_on_update ON dialog_analysis;

-- Удаляем функции триггеров
DROP FUNCTION IF EXISTS auto_assign_lead_on_insert();
DROP FUNCTION IF EXISTS auto_assign_lead_on_update();

-- Функция assign_lead_to_consultant() ОСТАВЛЯЕМ как утилиту (может понадобиться)

DO $$
BEGIN
    RAISE NOTICE 'Миграция 220: Триггеры автораспределения удалены. Логика перенесена в chatbot-service.';
END$$;
