-- =============================================
-- Миграция 173e: Флаг accepts_new_leads для консультантов
-- Описание: Добавляет возможность отключать консультанта от автоматического распределения лидов
-- Дата: 2026-01-31
-- =============================================

-- 1. ДОБАВЛЕНИЕ ПОЛЯ ACCEPTS_NEW_LEADS
-- =============================================

-- Добавляем поле для управления распределением лидов
ALTER TABLE consultants
ADD COLUMN IF NOT EXISTS accepts_new_leads BOOLEAN DEFAULT true NOT NULL;

-- Комментарий
COMMENT ON COLUMN consultants.accepts_new_leads IS 'Участвует ли консультант в автоматическом распределении новых лидов (не влияет на расписание и слоты)';

-- Индекс для быстрой фильтрации консультантов доступных для распределения
CREATE INDEX IF NOT EXISTS idx_consultants_available_for_leads
ON consultants(user_account_id, is_active, accepts_new_leads)
WHERE is_active = true AND accepts_new_leads = true;

-- 2. ОБНОВЛЕНИЕ ФУНКЦИИ ROUND-ROBIN РАСПРЕДЕЛЕНИЯ
-- =============================================

CREATE OR REPLACE FUNCTION assign_lead_to_consultant(
    p_user_account_id UUID
) RETURNS UUID AS $$
DECLARE
    v_consultant_id UUID;
    v_active_consultants UUID[];
BEGIN
    -- Получаем всех активных консультантов этого user_account
    -- которые принимают новых лидов
    SELECT array_agg(id ORDER BY id)
    INTO v_active_consultants
    FROM consultants
    WHERE is_active = true
      AND accepts_new_leads = true
      AND user_account_id = p_user_account_id;

    -- Если нет консультантов - возвращаем NULL
    IF v_active_consultants IS NULL OR array_length(v_active_consultants, 1) = 0 THEN
        RETURN NULL;
    END IF;

    -- Если только один консультант - возвращаем его
    IF array_length(v_active_consultants, 1) = 1 THEN
        RETURN v_active_consultants[1];
    END IF;

    -- Подсчитываем сколько лидов у каждого консультанта
    -- Round-robin: выбираем консультанта с минимальным количеством лидов
    WITH consultant_counts AS (
        SELECT
            c.id as consultant_id,
            COUNT(da.id) as lead_count
        FROM consultants c
        LEFT JOIN dialog_analysis da ON da.assigned_consultant_id = c.id
        WHERE c.id = ANY(v_active_consultants)
        GROUP BY c.id
    )
    SELECT consultant_id
    INTO v_consultant_id
    FROM consultant_counts
    ORDER BY lead_count ASC, consultant_id ASC
    LIMIT 1;

    RETURN v_consultant_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assign_lead_to_consultant IS 'Round-robin распределение нового лида среди активных консультантов принимающих новых лидов (is_active = true AND accepts_new_leads = true)';

-- 3. ОБНОВЛЕНИЕ VIEW ДЛЯ DASHBOARD
-- =============================================

-- Обновляем view чтобы включать информацию о принятии лидов
DROP VIEW IF EXISTS consultant_dashboard_stats CASCADE;

CREATE VIEW consultant_dashboard_stats AS
SELECT
    c.id as consultant_id,
    c.user_account_id,
    c.name as consultant_name,
    c.is_active,
    c.accepts_new_leads,

    -- Статистика лидов
    COUNT(DISTINCT da.id) as total_leads,
    COUNT(DISTINCT da.id) FILTER (WHERE da.interest_level = 'hot') as hot_leads,
    COUNT(DISTINCT da.id) FILTER (WHERE da.interest_level = 'warm') as warm_leads,
    COUNT(DISTINCT da.id) FILTER (WHERE da.interest_level = 'cold') as cold_leads,
    COUNT(DISTINCT da.id) FILTER (WHERE da.funnel_stage = 'consultation_booked') as booked_leads,

    -- Статистика консультаций
    COUNT(DISTINCT cons.id) as total_consultations,
    COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'scheduled') as scheduled,
    COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'confirmed') as confirmed,
    COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'completed') as completed,
    COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'cancelled') as cancelled,
    COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'no_show') as no_show,

    -- Доход (если заполнено)
    COALESCE(SUM(cons.price) FILTER (WHERE cons.status = 'completed'), 0) as total_revenue,

    -- Конверсия
    CASE
        WHEN COUNT(DISTINCT cons.id) > 0
        THEN ROUND(100.0 * COUNT(DISTINCT cons.id) FILTER (WHERE cons.status = 'completed') / COUNT(DISTINCT cons.id), 1)
        ELSE 0
    END as completion_rate

FROM consultants c
LEFT JOIN dialog_analysis da ON da.assigned_consultant_id = c.id
LEFT JOIN consultations cons ON cons.consultant_id = c.id
WHERE c.is_active = true
GROUP BY c.id, c.user_account_id, c.name, c.is_active, c.accepts_new_leads;

COMMENT ON VIEW consultant_dashboard_stats IS 'Статистика для dashboard консультанта (леды + консультации + доход + статус принятия лидов)';

-- Права на view
GRANT SELECT ON consultant_dashboard_stats TO authenticated;

-- =============================================
-- ЗАВЕРШЕНИЕ МИГРАЦИИ 173e
-- =============================================

DO $$
DECLARE
    total_consultants INTEGER;
    accepting_leads INTEGER;
BEGIN
    -- Считаем статистику
    SELECT COUNT(*) INTO total_consultants FROM consultants WHERE is_active = true;
    SELECT COUNT(*) INTO accepting_leads FROM consultants WHERE is_active = true AND accepts_new_leads = true;

    RAISE NOTICE '============================================';
    RAISE NOTICE 'Миграция 173e успешно применена';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'Добавлено поле: consultants.accepts_new_leads';
    RAISE NOTICE 'Обновлена функция: assign_lead_to_consultant';
    RAISE NOTICE 'Обновлён view: consultant_dashboard_stats';
    RAISE NOTICE '';
    RAISE NOTICE 'Статистика:';
    RAISE NOTICE '  - Активных консультантов: %', total_consultants;
    RAISE NOTICE '  - Принимающих новых лидов: %', accepting_leads;
    RAISE NOTICE '';
    RAISE NOTICE 'По умолчанию все консультанты accepts_new_leads = true';
    RAISE NOTICE 'Админ может управлять этим флагом через API';
    RAISE NOTICE '============================================';
END$$;
