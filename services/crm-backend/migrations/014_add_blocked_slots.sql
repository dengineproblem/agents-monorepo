-- Таблица для одноразовых блокировок слотов (перерывы, обед и т.д.)
-- В отличие от working_schedules, это разовые блокировки на конкретную дату

CREATE TABLE IF NOT EXISTS blocked_slots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    reason VARCHAR(255) DEFAULT 'Перерыв',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Валидация: время окончания должно быть после времени начала
    CONSTRAINT blocked_slots_time_check CHECK (end_time > start_time),

    -- Уникальность: один консультант не может иметь одинаковые блокировки
    UNIQUE(consultant_id, date, start_time)
);

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_blocked_slots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS blocked_slots_updated_at ON blocked_slots;
CREATE TRIGGER blocked_slots_updated_at
    BEFORE UPDATE ON blocked_slots
    FOR EACH ROW
    EXECUTE FUNCTION update_blocked_slots_updated_at();

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_blocked_slots_consultant_date
    ON blocked_slots(consultant_id, date);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_date
    ON blocked_slots(date);

-- RLS политики
ALTER TABLE blocked_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blocked_slots_select ON blocked_slots;
CREATE POLICY blocked_slots_select ON blocked_slots FOR SELECT USING (true);

DROP POLICY IF EXISTS blocked_slots_insert ON blocked_slots;
CREATE POLICY blocked_slots_insert ON blocked_slots FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS blocked_slots_update ON blocked_slots;
CREATE POLICY blocked_slots_update ON blocked_slots FOR UPDATE USING (true);

DROP POLICY IF EXISTS blocked_slots_delete ON blocked_slots;
CREATE POLICY blocked_slots_delete ON blocked_slots FOR DELETE USING (true);

COMMENT ON TABLE blocked_slots IS 'Одноразовые блокировки слотов (перерывы, обеды)';
COMMENT ON COLUMN blocked_slots.reason IS 'Причина блокировки для отображения в UI';
