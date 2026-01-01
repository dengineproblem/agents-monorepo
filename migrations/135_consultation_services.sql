-- Услуги консультаций
-- Позволяет создавать разные типы консультаций с разной длительностью и ценой

-- Таблица услуг
CREATE TABLE IF NOT EXISTS consultation_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    price DECIMAL(10, 2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'RUB',
    color VARCHAR(7) DEFAULT '#3B82F6', -- Цвет для отображения в календаре
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Связь консультантов с услугами (какие услуги может оказывать консультант)
CREATE TABLE IF NOT EXISTS consultant_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES consultation_services(id) ON DELETE CASCADE,
    custom_price DECIMAL(10, 2), -- Индивидуальная цена консультанта (если отличается)
    custom_duration INTEGER, -- Индивидуальная длительность
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(consultant_id, service_id)
);

-- Добавляем service_id к консультациям
ALTER TABLE consultations
    ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES consultation_services(id) ON DELETE SET NULL;

-- Добавляем цену к консультациям (фиксируем на момент записи)
ALTER TABLE consultations
    ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_consultation_services_user_account
    ON consultation_services(user_account_id);
CREATE INDEX IF NOT EXISTS idx_consultation_services_active
    ON consultation_services(user_account_id, is_active);
CREATE INDEX IF NOT EXISTS idx_consultant_services_consultant
    ON consultant_services(consultant_id);
CREATE INDEX IF NOT EXISTS idx_consultant_services_service
    ON consultant_services(service_id);
CREATE INDEX IF NOT EXISTS idx_consultations_service
    ON consultations(service_id);

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION update_consultation_services_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_consultation_services_updated_at ON consultation_services;
CREATE TRIGGER trigger_consultation_services_updated_at
    BEFORE UPDATE ON consultation_services
    FOR EACH ROW
    EXECUTE FUNCTION update_consultation_services_updated_at();

-- RLS (Row Level Security)
ALTER TABLE consultation_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_services ENABLE ROW LEVEL SECURITY;

-- Политики для consultation_services
DROP POLICY IF EXISTS consultation_services_select ON consultation_services;
CREATE POLICY consultation_services_select ON consultation_services
    FOR SELECT USING (true);

DROP POLICY IF EXISTS consultation_services_insert ON consultation_services;
CREATE POLICY consultation_services_insert ON consultation_services
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS consultation_services_update ON consultation_services;
CREATE POLICY consultation_services_update ON consultation_services
    FOR UPDATE USING (true);

DROP POLICY IF EXISTS consultation_services_delete ON consultation_services;
CREATE POLICY consultation_services_delete ON consultation_services
    FOR DELETE USING (true);

-- Политики для consultant_services
DROP POLICY IF EXISTS consultant_services_select ON consultant_services;
CREATE POLICY consultant_services_select ON consultant_services
    FOR SELECT USING (true);

DROP POLICY IF EXISTS consultant_services_insert ON consultant_services;
CREATE POLICY consultant_services_insert ON consultant_services
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS consultant_services_update ON consultant_services;
CREATE POLICY consultant_services_update ON consultant_services
    FOR UPDATE USING (true);

DROP POLICY IF EXISTS consultant_services_delete ON consultant_services;
CREATE POLICY consultant_services_delete ON consultant_services
    FOR DELETE USING (true);

COMMENT ON TABLE consultation_services IS 'Услуги консультаций с ценами и длительностью';
COMMENT ON TABLE consultant_services IS 'Связь консультантов с услугами которые они оказывают';
COMMENT ON COLUMN consultations.service_id IS 'Ссылка на услугу консультации';
COMMENT ON COLUMN consultations.price IS 'Цена консультации на момент записи';
