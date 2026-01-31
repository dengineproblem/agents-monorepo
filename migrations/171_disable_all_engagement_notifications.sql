-- Migration 171: Disable all engagement notifications
-- Created: 2026-01-30
-- Description: Отключить все автоматические уведомления для пользователей в воронке онбординга

-- Отключаем всю систему engagement уведомлений
UPDATE notification_settings
SET is_active = false,
    updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000001';

-- Комментарий для истории
COMMENT ON TABLE notification_settings IS 'Глобальные настройки системы engagement уведомлений (singleton) - ОТКЛЮЧЕНО 2026-01-30';
