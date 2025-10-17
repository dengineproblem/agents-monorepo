-- Таблица услуг
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    service_type VARCHAR(50) NOT NULL CHECK (service_type IN ('online', 'offline', 'hybrid')),
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    price DECIMAL(10,2),
    currency VARCHAR(3) DEFAULT 'RUB',
    is_active BOOLEAN DEFAULT true,
    category VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Таблица продаж
CREATE TABLE IF NOT EXISTS sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID REFERENCES consultations(id),
    service_id UUID REFERENCES services(id),
    client_phone VARCHAR(20) NOT NULL,
    client_name VARCHAR(255),
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'RUB',
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'paid', 'cancelled', 'refunded')),
    payment_method VARCHAR(50),
    sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_by UUID, -- ID консультанта/менеджера
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Таблица для связи услуг с консультантами (кто какие услуги может предоставлять)
CREATE TABLE IF NOT EXISTS consultant_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id UUID REFERENCES consultants(id),
    service_id UUID REFERENCES services(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(consultant_id, service_id)
);

-- Обновляем таблицу консультаций для связи с услугами
ALTER TABLE consultations 
ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id),
ADD COLUMN IF NOT EXISTS actual_duration_minutes INTEGER,
ADD COLUMN IF NOT EXISTS is_sale_closed BOOLEAN DEFAULT false;

-- Индексы для оптимизации
CREATE INDEX IF NOT EXISTS idx_services_type ON services(service_type);
CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_consultation ON sales(consultation_id);
CREATE INDEX IF NOT EXISTS idx_consultant_services_consultant ON consultant_services(consultant_id);

-- Триггеры для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Вставляем тестовые услуги
INSERT INTO services (name, description, service_type, duration_minutes, price, category) VALUES
('Консультация по таргетингу (онлайн)', 'Онлайн консультация по настройке таргетированной рекламы', 'online', 30, 3000.00, 'Реклама'),
('Консультация по таргетингу (офлайн)', 'Очная консультация по настройке таргетированной рекламы', 'offline', 60, 5000.00, 'Реклама'),
('Аудит рекламных кампаний', 'Полный аудит существующих рекламных кампаний', 'online', 45, 4000.00, 'Аудит'),
('Настройка CRM системы', 'Настройка и интеграция CRM системы', 'offline', 120, 15000.00, 'CRM'),
('Обучение команды', 'Обучение команды работе с рекламными инструментами', 'hybrid', 90, 8000.00, 'Обучение'),
('Стратегическая сессия', 'Разработка маркетинговой стратегии', 'offline', 180, 25000.00, 'Стратегия');

-- Связываем консультантов с услугами
INSERT INTO consultant_services (consultant_id, service_id) 
SELECT c.id, s.id 
FROM consultants c, services s 
WHERE c.specialization = 'Маркетинг' AND s.category = 'Реклама'
ON CONFLICT (consultant_id, service_id) DO NOTHING;

INSERT INTO consultant_services (consultant_id, service_id) 
SELECT c.id, s.id 
FROM consultants c, services s 
WHERE c.specialization = 'Продажи' AND s.category IN ('CRM', 'Обучение')
ON CONFLICT (consultant_id, service_id) DO NOTHING;

INSERT INTO consultant_services (consultant_id, service_id) 
SELECT c.id, s.id 
FROM consultants c, services s 
WHERE c.specialization = 'Аналитика' AND s.category IN ('Аудит', 'Стратегия')
ON CONFLICT (consultant_id, service_id) DO NOTHING;

-- Тестовые продажи
INSERT INTO sales (consultation_id, service_id, client_phone, client_name, amount, status, sale_date, created_by) 
VALUES 
(
    (SELECT id FROM consultations LIMIT 1),
    (SELECT id FROM services WHERE name LIKE '%онлайн%' LIMIT 1),
    '+7 (999) 111-22-33',
    'Иван Иванов',
    3000.00,
    'paid',
    CURRENT_DATE - INTERVAL '1 day',
    (SELECT id FROM consultants LIMIT 1)
),
(
    (SELECT id FROM consultations OFFSET 1 LIMIT 1),
    (SELECT id FROM services WHERE name LIKE '%офлайн%' LIMIT 1),
    '+7 (999) 222-33-44',
    'Петр Петров',
    5000.00,
    'confirmed',
    CURRENT_DATE,
    (SELECT id FROM consultants LIMIT 1)
);

-- Представление для аналитики продаж
CREATE OR REPLACE VIEW sales_analytics AS
SELECT 
    DATE_TRUNC('month', s.sale_date) as month,
    srv.category,
    srv.service_type,
    COUNT(*) as total_sales,
    SUM(s.amount) as total_revenue,
    AVG(s.amount) as avg_sale_amount,
    COUNT(CASE WHEN s.status = 'paid' THEN 1 END) as paid_sales,
    COUNT(CASE WHEN s.status = 'confirmed' THEN 1 END) as confirmed_sales,
    COUNT(CASE WHEN s.status = 'cancelled' THEN 1 END) as cancelled_sales
FROM sales s
JOIN services srv ON s.service_id = srv.id
GROUP BY DATE_TRUNC('month', s.sale_date), srv.category, srv.service_type
ORDER BY month DESC, total_revenue DESC;

-- Представление для конверсии консультаций в продажи
CREATE OR REPLACE VIEW consultation_conversion AS
SELECT 
    DATE_TRUNC('month', c.date::date) as month,
    COUNT(*) as total_consultations,
    COUNT(s.id) as consultations_with_sales,
    ROUND(
        (COUNT(s.id)::decimal / COUNT(*)::decimal) * 100, 2
    ) as conversion_rate,
    SUM(COALESCE(s.amount, 0)) as total_revenue_from_consultations
FROM consultations c
LEFT JOIN sales s ON c.id = s.consultation_id
GROUP BY DATE_TRUNC('month', c.date::date)
ORDER BY month DESC; 