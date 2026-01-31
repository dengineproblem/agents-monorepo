-- =============================================
-- Миграция 173c: RLS политики для консультантов
-- Описание: Настройка Row Level Security для ролей
-- Дата: 2026-01-31
-- =============================================

-- 1. RLS ПОЛИТИКИ ДЛЯ DIALOG_ANALYSIS
-- =============================================

-- Обновляем политики для dialog_analysis
DROP POLICY IF EXISTS dialog_analysis_select ON dialog_analysis;
CREATE POLICY dialog_analysis_select ON dialog_analysis
    FOR SELECT
    USING (
        -- Админ видит всё
        EXISTS (
            SELECT 1 FROM user_accounts
            WHERE id = auth.uid()
              AND (is_tech_admin = true OR role = 'admin')
        )
        OR
        -- Консультант видит только свои леды
        EXISTS (
            SELECT 1 FROM consultants
            WHERE user_account_id = auth.uid()
              AND id = dialog_analysis.assigned_consultant_id
        )
        OR
        -- Или леды его user_account (для совместимости)
        user_account_id = auth.uid()
    );

-- 2. RLS ПОЛИТИКИ ДЛЯ CONSULTATIONS
-- =============================================

-- Обновляем политики для consultations
DROP POLICY IF EXISTS consultations_select ON consultations;
CREATE POLICY consultations_select ON consultations
    FOR SELECT
    USING (
        -- Админ видит всё
        EXISTS (
            SELECT 1 FROM user_accounts
            WHERE id = auth.uid()
              AND (is_tech_admin = true OR role = 'admin')
        )
        OR
        -- Консультант видит только свои записи
        consultant_id IN (
            SELECT id FROM consultants WHERE user_account_id = auth.uid()
        )
        OR
        -- Или записи его user_account (для совместимости)
        user_account_id = auth.uid()
    );

-- 3. RLS ПОЛИТИКИ ДЛЯ CONSULTANT_CALL_LOGS
-- =============================================

ALTER TABLE consultant_call_logs ENABLE ROW LEVEL SECURITY;

-- Политика SELECT
DROP POLICY IF EXISTS consultant_call_logs_select ON consultant_call_logs;
CREATE POLICY consultant_call_logs_select ON consultant_call_logs
    FOR SELECT
    USING (
        -- Админ видит всё
        EXISTS (
            SELECT 1 FROM user_accounts
            WHERE id = auth.uid()
              AND (is_tech_admin = true OR role = 'admin')
        )
        OR
        -- Консультант видит только свои звонки
        consultant_id IN (
            SELECT id FROM consultants WHERE user_account_id = auth.uid()
        )
    );

-- Политика INSERT
DROP POLICY IF EXISTS consultant_call_logs_insert ON consultant_call_logs;
CREATE POLICY consultant_call_logs_insert ON consultant_call_logs
    FOR INSERT
    WITH CHECK (
        -- Админ может создавать
        EXISTS (
            SELECT 1 FROM user_accounts
            WHERE id = auth.uid()
              AND (is_tech_admin = true OR role = 'admin')
        )
        OR
        -- Консультант может создавать только свои звонки
        consultant_id IN (
            SELECT id FROM consultants WHERE user_account_id = auth.uid()
        )
    );

-- Политика UPDATE
DROP POLICY IF EXISTS consultant_call_logs_update ON consultant_call_logs;
CREATE POLICY consultant_call_logs_update ON consultant_call_logs
    FOR UPDATE
    USING (
        -- Админ может обновлять
        EXISTS (
            SELECT 1 FROM user_accounts
            WHERE id = auth.uid()
              AND (is_tech_admin = true OR role = 'admin')
        )
        OR
        -- Консультант может обновлять только свои звонки
        consultant_id IN (
            SELECT id FROM consultants WHERE user_account_id = auth.uid()
        )
    );

-- =============================================
-- ЗАВЕРШЕНИЕ МИГРАЦИИ 173c
-- =============================================

DO $$
BEGIN
    RAISE NOTICE 'Миграция 173c успешно применена: RLS политики для консультантов';
END$$;
