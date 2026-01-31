-- =============================================
-- Миграция 173a: Базовые изменения для ролей консультантов
-- Описание: Добавляет систему ролей, assigned_consultant_id, таблицу call_logs
-- Дата: 2026-01-31
-- =============================================

-- 1. ДОБАВЛЕНИЕ СИСТЕМЫ РОЛЕЙ К USER_ACCOUNTS
-- =============================================

-- Создаём тип для ролей
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'consultant', 'manager');
    END IF;
END$$;

-- Добавляем поле role к user_accounts (по умолчанию admin для совместимости)
ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS role user_role DEFAULT 'admin';

-- Комментарий
COMMENT ON COLUMN user_accounts.role IS 'Роль пользователя: admin (полный доступ), consultant (только свои данные), manager (аналитика)';

-- Индекс для быстрого поиска по ролям
CREATE INDEX IF NOT EXISTS idx_user_accounts_role
ON user_accounts(role);

-- 2. КОММЕНТАРИЙ К CONSULTANTS.USER_ACCOUNT_ID
-- =============================================

COMMENT ON COLUMN consultants.user_account_id IS 'Связь с user_accounts (для логина консультанта). Уникальность будет добавлена в миграции 173d после очистки дубликатов';

-- Индекс для быстрого поиска консультанта по user_account_id
CREATE INDEX IF NOT EXISTS idx_consultants_user_account
ON consultants(user_account_id)
WHERE user_account_id IS NOT NULL;

-- 3. ДОБАВЛЕНИЕ ASSIGNED_CONSULTANT_ID К DIALOG_ANALYSIS
-- =============================================

-- Добавляем поле для закрепления лида за консультантом
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS assigned_consultant_id UUID REFERENCES consultants(id) ON DELETE SET NULL;

-- Индекс для быстрой фильтрации лидов по консультанту
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_assigned_consultant
ON dialog_analysis(assigned_consultant_id)
WHERE assigned_consultant_id IS NOT NULL;

-- Комментарий
COMMENT ON COLUMN dialog_analysis.assigned_consultant_id IS 'Консультант закреплённый за лидом (round-robin при первом сообщении)';

-- 4. ТАБЛИЦА ДЛЯ ИСТОРИИ ПРОЗВОНОВ
-- =============================================

CREATE TABLE IF NOT EXISTS consultant_call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id UUID REFERENCES consultants(id) ON DELETE CASCADE NOT NULL,
    lead_id UUID REFERENCES dialog_analysis(id) ON DELETE CASCADE NOT NULL,
    called_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    result VARCHAR(50), -- 'answered', 'no_answer', 'busy', 'scheduled'
    notes TEXT,
    next_follow_up TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_consultant_call_logs_consultant
ON consultant_call_logs(consultant_id);

CREATE INDEX IF NOT EXISTS idx_consultant_call_logs_lead
ON consultant_call_logs(lead_id);

CREATE INDEX IF NOT EXISTS idx_consultant_call_logs_consultant_lead
ON consultant_call_logs(consultant_id, lead_id);

-- Комментарий
COMMENT ON TABLE consultant_call_logs IS 'История прозвонов консультантами незаписавшихся лидов';

-- Триггер автообновления updated_at
CREATE OR REPLACE FUNCTION update_consultant_call_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_consultant_call_logs_updated_at ON consultant_call_logs;
CREATE TRIGGER trigger_update_consultant_call_logs_updated_at
BEFORE UPDATE ON consultant_call_logs
FOR EACH ROW
EXECUTE FUNCTION update_consultant_call_logs_updated_at();

-- 5. ДОПОЛНИТЕЛЬНЫЕ ИНДЕКСЫ ДЛЯ ПРОИЗВОДИТЕЛЬНОСТИ
-- =============================================

-- Композитный индекс для фильтрации лидов консультанта по статусу
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_consultant_funnel
ON dialog_analysis(assigned_consultant_id, funnel_stage)
WHERE assigned_consultant_id IS NOT NULL;

-- Индекс для поиска лидов консультанта по interest_level
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_consultant_interest
ON dialog_analysis(assigned_consultant_id, interest_level)
WHERE assigned_consultant_id IS NOT NULL;

-- Композитный индекс для сортировки лидов консультанта по времени
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_consultant_time
ON dialog_analysis(assigned_consultant_id, last_message DESC)
WHERE assigned_consultant_id IS NOT NULL;

-- =============================================
-- ЗАВЕРШЕНИЕ МИГРАЦИИ 173a
-- =============================================

DO $$
BEGIN
    RAISE NOTICE 'Миграция 173a успешно применена: роли, assigned_consultant_id, таблица call_logs, индексы';
END$$;
