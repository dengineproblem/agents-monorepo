-- Исправление проблемы с внешним ключом slot_id
-- Убираем ограничение внешнего ключа, так как мы не используем таблицу consultation_slots

-- Сначала проверим, какие ограничения есть на таблице consultations
-- SELECT constraint_name, constraint_type 
-- FROM information_schema.table_constraints 
-- WHERE table_name = 'consultations' AND constraint_type = 'FOREIGN KEY';

-- Удаляем ограничение внешнего ключа на slot_id (если оно существует)
DO $$ 
BEGIN
    -- Проверяем, существует ли ограничение
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'consultations_slot_id_fkey' 
        AND table_name = 'consultations'
    ) THEN
        -- Удаляем ограничение
        ALTER TABLE consultations DROP CONSTRAINT consultations_slot_id_fkey;
        RAISE NOTICE 'Ограничение consultations_slot_id_fkey удалено';
    ELSE
        RAISE NOTICE 'Ограничение consultations_slot_id_fkey не найдено';
    END IF;
END $$;

-- Альтернативно, можно изменить тип поля slot_id на обычный текст
-- если нужно сохранить совместимость
-- ALTER TABLE consultations ALTER COLUMN slot_id TYPE TEXT;

-- Проверяем результат
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'consultations' AND constraint_type = 'FOREIGN KEY'; 