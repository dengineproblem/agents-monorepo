-- =============================================
-- Миграция 173b: Функции и View для консультантов
-- Описание: Функция round-robin распределения, view для dashboard
-- Дата: 2026-01-31
-- =============================================

-- 1. ФУНКЦИЯ ROUND-ROBIN РАСПРЕДЕЛЕНИЯ ЛИДОВ
-- =============================================

CREATE OR REPLACE FUNCTION assign_lead_to_consultant(
    p_user_account_id UUID
) RETURNS UUID AS $$
DECLARE
    v_consultant_id UUID;
    v_active_consultants UUID[];
BEGIN
    -- Получаем всех активных консультантов этого user_account
    SELECT array_agg(id ORDER BY id)
    INTO v_active_consultants
    FROM consultants
    WHERE is_active = true
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

COMMENT ON FUNCTION assign_lead_to_consultant IS 'Round-robin распределение нового лида среди активных консультантов (по минимальному количеству лидов)';

-- 2. VIEW ДЛЯ DASHBOARD КОНСУЛЬТАНТА
-- =============================================

CREATE OR REPLACE VIEW consultant_dashboard_stats AS
SELECT
    c.id as consultant_id,
    c.user_account_id,
    c.name as consultant_name,

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
GROUP BY c.id, c.user_account_id, c.name;

COMMENT ON VIEW consultant_dashboard_stats IS 'Статистика для dashboard консультанта (леды + консультации + доход)';

-- Права на view
GRANT SELECT ON consultant_dashboard_stats TO authenticated;

-- =============================================
-- ЗАВЕРШЕНИЕ МИГРАЦИИ 173b
-- =============================================

DO $$
BEGIN
    RAISE NOTICE 'Миграция 173b успешно применена: функция round-robin, view для dashboard';
END$$;
