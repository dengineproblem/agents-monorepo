-- Исправление foreign key для consultations.service_id
-- FK должен ссылаться на consultation_services(id)

-- Удаляем старый FK (если существует)
ALTER TABLE consultations
    DROP CONSTRAINT IF EXISTS consultations_service_id_fkey;

-- Создаём правильный FK
ALTER TABLE consultations
    ADD CONSTRAINT consultations_service_id_fkey
    FOREIGN KEY (service_id)
    REFERENCES consultation_services(id)
    ON DELETE SET NULL;
