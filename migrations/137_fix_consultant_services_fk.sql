-- Исправление foreign key для consultant_services
-- FK должен ссылаться на consultation_services(id), а не на какую-то другую таблицу

-- Удаляем старый FK (если существует)
ALTER TABLE consultant_services
    DROP CONSTRAINT IF EXISTS consultant_services_service_id_fkey;

-- Создаём правильный FK
ALTER TABLE consultant_services
    ADD CONSTRAINT consultant_services_service_id_fkey
    FOREIGN KEY (service_id)
    REFERENCES consultation_services(id)
    ON DELETE CASCADE;

-- Проверяем что нет осиротевших записей
DELETE FROM consultant_services
WHERE service_id NOT IN (SELECT id FROM consultation_services);
