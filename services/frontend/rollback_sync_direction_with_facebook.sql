-- ROLLBACK: Отмена миграции синхронизации с Facebook
-- Дата: 2025-10-11
-- Описание: Откатывает все изменения из sync_direction_with_facebook.sql

-- =====================================================
-- 1. Удаляем триггер
-- =====================================================
DROP TRIGGER IF EXISTS trigger_sync_direction_with_facebook ON account_directions;

-- =====================================================
-- 2. Удаляем функции
-- =====================================================
DROP FUNCTION IF EXISTS sync_direction_status_with_facebook();
DROP FUNCTION IF EXISTS toggle_direction_status(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS log_direction_sync(UUID, TEXT, TEXT, TEXT, TEXT);

-- =====================================================
-- 3. Удаляем таблицу логов
-- =====================================================
DROP TABLE IF EXISTS direction_sync_log CASCADE;

-- =====================================================
-- 4. Удаляем расширение pg_net (опционально, осторожно!)
-- =====================================================
-- РАСКОММЕНТИРУЙ ТОЛЬКО ЕСЛИ pg_net не используется в других местах:
-- DROP EXTENSION IF EXISTS pg_net;

-- =====================================================
-- Готово! Все изменения отменены
-- =====================================================
SELECT 'Rollback completed successfully!' as status;

