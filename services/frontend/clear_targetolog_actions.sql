-- Очистка таблицы действий таргетолога
-- Удаляет все тестовые/сгенерированные записи

DELETE FROM targetolog_actions;

-- Сброс автоинкремента (опционально)
-- ALTER SEQUENCE targetolog_actions_id_seq RESTART WITH 1;

-- Проверка что таблица пуста
SELECT COUNT(*) as remaining_records FROM targetolog_actions;