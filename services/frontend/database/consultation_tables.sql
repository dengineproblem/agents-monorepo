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

-- Таблица временных слотов для консультаций
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
    slot_id UUID REFERENCES consultation_slots(id) ON DELETE CASCADE,
    client_phone VARCHAR(50) NOT NULL,
    client_name VARCHAR(255),
    client_chat_id VARCHAR(255), -- связь с чатом из n8n_chat_histories
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
    notes TEXT,
    consultation_type VARCHAR(100) DEFAULT 'general',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_working_schedules_consultant_day ON working_schedules(consultant_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_consultation_slots_consultant_date ON consultation_slots(consultant_id, date);
CREATE INDEX IF NOT EXISTS idx_consultation_slots_available ON consultation_slots(is_available, is_blocked);
CREATE INDEX IF NOT EXISTS idx_consultations_consultant_date ON consultations(consultant_id, date);
CREATE INDEX IF NOT EXISTS idx_consultations_client_phone ON consultations(client_phone);
CREATE INDEX IF NOT EXISTS idx_consultations_status ON consultations(status);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггеры для автоматического обновления updated_at
CREATE TRIGGER update_consultants_updated_at BEFORE UPDATE ON consultants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_working_schedules_updated_at BEFORE UPDATE ON working_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_consultation_slots_updated_at BEFORE UPDATE ON consultation_slots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_consultations_updated_at BEFORE UPDATE ON consultations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Вставка тестового консультанта
INSERT INTO consultants (name, email, phone, specialization) 
VALUES ('Анна Консультант', 'anna@example.com', '+7900123456', 'Маркетинг и реклама')
ON CONFLICT (email) DO NOTHING;

-- Вставка тестового расписания (понедельник-пятница, 9:00-18:00)
INSERT INTO working_schedules (consultant_id, day_of_week, start_time, end_time)
SELECT 
    c.id,
    generate_series(1, 5) as day_of_week, -- понедельник-пятница
    '09:00'::time as start_time,
    '18:00'::time as end_time
FROM consultants c 
WHERE c.email = 'anna@example.com'
ON CONFLICT (consultant_id, day_of_week) DO NOTHING; 