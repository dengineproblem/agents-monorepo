-- ==============================================
-- Migration: 015 - Add Consultant Tasks System
-- Description: Система задач для консультантов
-- Author: AI Assistant (Claude Sonnet 4.5)
-- Date: 2026-02-02
-- ==============================================

-- Создание таблицы задач консультантов
CREATE TABLE IF NOT EXISTS consultant_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Связи
    consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
    user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES dialog_analysis(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

    -- Основные поля
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled')),
    due_date DATE NOT NULL,

    -- Результаты выполнения
    result_notes TEXT,
    completed_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ==============================================
-- Индексы для оптимизации запросов
-- ==============================================

-- Основной индекс по консультанту
CREATE INDEX IF NOT EXISTS idx_consultant_tasks_consultant
ON consultant_tasks(consultant_id);

-- Индекс для фильтрации по статусу
CREATE INDEX IF NOT EXISTS idx_consultant_tasks_status
ON consultant_tasks(consultant_id, status);

-- Индекс для сортировки по дате (только для незавершенных)
CREATE INDEX IF NOT EXISTS idx_consultant_tasks_due_date
ON consultant_tasks(consultant_id, due_date)
WHERE status != 'completed';

-- Индекс для поиска задач по лиду
CREATE INDEX IF NOT EXISTS idx_consultant_tasks_lead
ON consultant_tasks(lead_id)
WHERE lead_id IS NOT NULL;

-- Комбо-индекс для dashboard и основного списка
CREATE INDEX IF NOT EXISTS idx_consultant_tasks_dashboard
ON consultant_tasks(consultant_id, status, due_date)
WHERE status IN ('pending', 'completed');

-- ==============================================
-- Триггер для автообновления updated_at
-- ==============================================

-- Функция обновления timestamp
CREATE OR REPLACE FUNCTION update_consultant_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер на обновление
DROP TRIGGER IF EXISTS trigger_consultant_tasks_updated_at ON consultant_tasks;
CREATE TRIGGER trigger_consultant_tasks_updated_at
BEFORE UPDATE ON consultant_tasks
FOR EACH ROW
EXECUTE FUNCTION update_consultant_tasks_updated_at();

-- ==============================================
-- Комментарии к таблице и колонкам
-- ==============================================

COMMENT ON TABLE consultant_tasks IS 'Задачи консультантов (напоминания, follow-ups, дела по лидам)';

COMMENT ON COLUMN consultant_tasks.consultant_id IS 'ID консультанта-владельца задачи';
COMMENT ON COLUMN consultant_tasks.user_account_id IS 'ID аккаунта владельца (для RLS)';
COMMENT ON COLUMN consultant_tasks.lead_id IS 'Опциональная связь с лидом (NULL для общих задач)';
COMMENT ON COLUMN consultant_tasks.created_by_user_id IS 'Кто создал задачу (для отображения badge "Назначена админом")';
COMMENT ON COLUMN consultant_tasks.title IS 'Название задачи (обязательное, до 500 символов)';
COMMENT ON COLUMN consultant_tasks.description IS 'Детальное описание задачи (опционально)';
COMMENT ON COLUMN consultant_tasks.status IS 'Статус: pending (новая), completed (выполнена), cancelled (отменена)';
COMMENT ON COLUMN consultant_tasks.due_date IS 'Дата выполнения задачи (обязательная)';
COMMENT ON COLUMN consultant_tasks.result_notes IS 'Заметки о результате выполнения (заполняется при completed)';
COMMENT ON COLUMN consultant_tasks.completed_at IS 'Timestamp завершения задачи (автоматически при status=completed)';

-- ==============================================
-- Row Level Security (RLS)
-- ==============================================

-- Включаем RLS для таблицы
ALTER TABLE consultant_tasks ENABLE ROW LEVEL SECURITY;

-- Политика для админов: полный доступ ко всем задачам
DROP POLICY IF EXISTS "Admins can do anything with tasks" ON consultant_tasks;
CREATE POLICY "Admins can do anything with tasks" ON consultant_tasks
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM user_accounts
            WHERE user_accounts.id = auth.uid()
            AND (user_accounts.role = 'admin' OR user_accounts.is_tech_admin = true)
        )
    );

-- Политика для консультантов: доступ только к своим задачам
DROP POLICY IF EXISTS "Consultants can manage their own tasks" ON consultant_tasks;
CREATE POLICY "Consultants can manage their own tasks" ON consultant_tasks
    FOR ALL
    USING (
        user_account_id = auth.uid()
        OR consultant_id IN (
            SELECT id FROM consultants
            WHERE parent_user_account_id = auth.uid()
        )
    );

-- ==============================================
-- Примеры запросов для тестирования
-- ==============================================

-- Получить все задачи консультанта
-- SELECT * FROM consultant_tasks
-- WHERE consultant_id = '<consultant_uuid>'
-- ORDER BY due_date ASC;

-- Получить просроченные задачи
-- SELECT * FROM consultant_tasks
-- WHERE consultant_id = '<consultant_uuid>'
-- AND status = 'pending'
-- AND due_date < CURRENT_DATE
-- ORDER BY due_date ASC;

-- Получить задачи на сегодня
-- SELECT * FROM consultant_tasks
-- WHERE consultant_id = '<consultant_uuid>'
-- AND status = 'pending'
-- AND due_date = CURRENT_DATE;

-- Получить задачи по лиду
-- SELECT * FROM consultant_tasks
-- WHERE lead_id = '<lead_uuid>'
-- ORDER BY due_date ASC;

-- Статистика задач для dashboard
-- SELECT
--   COUNT(*) FILTER (WHERE status = 'pending') as tasks_total,
--   COUNT(*) FILTER (WHERE status = 'pending' AND due_date < CURRENT_DATE) as tasks_overdue,
--   COUNT(*) FILTER (WHERE status = 'pending' AND due_date = CURRENT_DATE) as tasks_today
-- FROM consultant_tasks
-- WHERE consultant_id = '<consultant_uuid>';
