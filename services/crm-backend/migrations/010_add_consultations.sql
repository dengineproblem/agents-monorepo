-- Миграция: Система консультаций
-- Создаёт таблицы для управления консультантами, расписаниями и записями

-- Таблица сотрудников-консультантов
CREATE TABLE IF NOT EXISTS consultants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    specialization VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Таблица рабочих расписаний
CREATE TABLE IF NOT EXISTS working_schedules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    consultant_id UUID REFERENCES consultants(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0 = воскресенье, 1 = понедельник, и т.д.
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(consultant_id, day_of_week)
);

-- Таблица временных слотов для консультаций (опционально, для более гибкого управления)
CREATE TABLE IF NOT EXISTS consultation_slots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    consultant_id UUID REFERENCES consultants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN DEFAULT true,
    is_blocked BOOLEAN DEFAULT false, -- для ручной блокировки слотов
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(consultant_id, date, start_time)
);

-- Таблица записей на консультации
CREATE TABLE IF NOT EXISTS consultations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    consultant_id UUID REFERENCES consultants(id) ON DELETE CASCADE,
    slot_id UUID REFERENCES consultation_slots(id) ON DELETE SET NULL,
    dialog_analysis_id UUID, -- связь с лидом из CRM (FK добавляется позже если таблица существует)
    client_phone VARCHAR(50) NOT NULL,
    client_name VARCHAR(255),
    client_chat_id VARCHAR(255), -- связь с чатом из WhatsApp
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
    notes TEXT,
    consultation_type VARCHAR(100) DEFAULT 'general',
    actual_duration_minutes INTEGER,
    is_sale_closed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Добавить колонку dialog_analysis_id если таблица уже существует
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS dialog_analysis_id UUID;

-- Индексы для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_consultants_active ON consultants(is_active);
CREATE INDEX IF NOT EXISTS idx_working_schedules_consultant_day ON working_schedules(consultant_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_consultation_slots_consultant_date ON consultation_slots(consultant_id, date);
CREATE INDEX IF NOT EXISTS idx_consultation_slots_available ON consultation_slots(is_available, is_blocked);
CREATE INDEX IF NOT EXISTS idx_consultations_consultant_date ON consultations(consultant_id, date);
CREATE INDEX IF NOT EXISTS idx_consultations_client_phone ON consultations(client_phone);
CREATE INDEX IF NOT EXISTS idx_consultations_status ON consultations(status);
CREATE INDEX IF NOT EXISTS idx_consultations_dialog_analysis ON consultations(dialog_analysis_id);

-- Функция для автоматического обновления updated_at (если ещё не существует)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггеры для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_consultants_updated_at ON consultants;
CREATE TRIGGER update_consultants_updated_at
    BEFORE UPDATE ON consultants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_working_schedules_updated_at ON working_schedules;
CREATE TRIGGER update_working_schedules_updated_at
    BEFORE UPDATE ON working_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_consultation_slots_updated_at ON consultation_slots;
CREATE TRIGGER update_consultation_slots_updated_at
    BEFORE UPDATE ON consultation_slots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_consultations_updated_at ON consultations;
CREATE TRIGGER update_consultations_updated_at
    BEFORE UPDATE ON consultations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Комментарии к таблицам
COMMENT ON TABLE consultants IS 'Сотрудники-консультанты для записи клиентов';
COMMENT ON TABLE working_schedules IS 'Рабочие расписания консультантов по дням недели';
COMMENT ON TABLE consultation_slots IS 'Временные слоты для записи на консультации';
COMMENT ON TABLE consultations IS 'Записи клиентов на консультации';
COMMENT ON COLUMN consultations.dialog_analysis_id IS 'Связь с лидом из CRM (таблица dialog_analysis)';
COMMENT ON COLUMN consultations.is_sale_closed IS 'Была ли закрыта продажа после консультации';
