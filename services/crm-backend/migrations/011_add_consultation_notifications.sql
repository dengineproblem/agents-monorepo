-- Миграция: Система уведомлений о консультациях
-- Добавляет user_account_id к консультантам и консультациям
-- Создаёт таблицы для настроек и истории уведомлений

-- ==================== ДОБАВЛЕНИЕ user_account_id ====================

-- Добавляем user_account_id к консультантам
ALTER TABLE consultants
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

-- Добавляем user_account_id к консультациям
ALTER TABLE consultations
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

-- Индексы для фильтрации по аккаунту
CREATE INDEX IF NOT EXISTS idx_consultants_user_account ON consultants(user_account_id);
CREATE INDEX IF NOT EXISTS idx_consultations_user_account ON consultations(user_account_id);

-- ==================== НАСТРОЙКИ УВЕДОМЛЕНИЙ ====================

-- Таблица настроек уведомлений (на уровне аккаунта)
CREATE TABLE IF NOT EXISTS consultation_notification_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE UNIQUE,

    -- Стандартные уведомления (можно отключить)
    confirmation_enabled BOOLEAN DEFAULT true,
    confirmation_template TEXT DEFAULT 'Здравствуйте{{#client_name}}, {{client_name}}{{/client_name}}! Вы записаны на консультацию {{date}} в {{time}}. До встречи!',

    reminder_24h_enabled BOOLEAN DEFAULT true,
    reminder_24h_template TEXT DEFAULT 'Напоминаем о вашей консультации завтра {{date}} в {{time}}. Ждём вас!',

    reminder_1h_enabled BOOLEAN DEFAULT true,
    reminder_1h_template TEXT DEFAULT 'Через час у вас консультация в {{time}}. До скорой встречи!',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== КАСТОМНЫЕ ШАБЛОНЫ УВЕДОМЛЕНИЙ ====================

-- Таблица кастомных уведомлений (дополнительные напоминания)
CREATE TABLE IF NOT EXISTS consultation_notification_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL, -- название для UI (например, "За 3 дня до визита")

    -- Когда отправлять (в минутах до консультации)
    minutes_before INTEGER NOT NULL, -- например: 4320 = 3 дня, 120 = 2 часа

    template TEXT NOT NULL, -- текст с переменными {{client_name}}, {{date}}, {{time}}, {{consultant_name}}

    is_enabled BOOLEAN DEFAULT true,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_account ON consultation_notification_templates(user_account_id);
CREATE INDEX IF NOT EXISTS idx_notification_templates_enabled ON consultation_notification_templates(user_account_id, is_enabled);

-- ==================== ИСТОРИЯ УВЕДОМЛЕНИЙ ====================

-- Таблица истории отправленных уведомлений
CREATE TABLE IF NOT EXISTS consultation_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    consultation_id UUID REFERENCES consultations(id) ON DELETE CASCADE,

    notification_type VARCHAR(50) NOT NULL, -- 'confirmation', 'reminder_24h', 'reminder_1h', 'custom'
    template_id UUID REFERENCES consultation_notification_templates(id) ON DELETE SET NULL, -- для кастомных

    message_text TEXT NOT NULL, -- финальный текст после подстановки переменных

    instance_name VARCHAR(255), -- WhatsApp инстанс откуда отправлено
    phone VARCHAR(50) NOT NULL, -- куда отправлено

    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'skipped'
    error_message TEXT,

    scheduled_at TIMESTAMP WITH TIME ZONE, -- когда должно быть отправлено
    sent_at TIMESTAMP WITH TIME ZONE, -- когда реально отправлено

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultation_notifications_consultation ON consultation_notifications(consultation_id);
CREATE INDEX IF NOT EXISTS idx_consultation_notifications_status ON consultation_notifications(status);
CREATE INDEX IF NOT EXISTS idx_consultation_notifications_scheduled ON consultation_notifications(status, scheduled_at);

-- ==================== ТРИГГЕРЫ ====================

-- Триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_consultation_notification_settings_updated_at ON consultation_notification_settings;
CREATE TRIGGER update_consultation_notification_settings_updated_at
    BEFORE UPDATE ON consultation_notification_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_consultation_notification_templates_updated_at ON consultation_notification_templates;
CREATE TRIGGER update_consultation_notification_templates_updated_at
    BEFORE UPDATE ON consultation_notification_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================== КОММЕНТАРИИ ====================

COMMENT ON TABLE consultation_notification_settings IS 'Настройки уведомлений о консультациях на уровне аккаунта';
COMMENT ON TABLE consultation_notification_templates IS 'Кастомные шаблоны уведомлений (дополнительные напоминания)';
COMMENT ON TABLE consultation_notifications IS 'История отправленных уведомлений о консультациях';

COMMENT ON COLUMN consultation_notification_templates.minutes_before IS 'За сколько минут до консультации отправить уведомление';
COMMENT ON COLUMN consultation_notifications.notification_type IS 'Тип: confirmation, reminder_24h, reminder_1h, custom';
