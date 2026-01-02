-- Обновление шаблонов уведомлений для консультаций
-- Добавлены переменные: {{service_name}}, {{time_remaining}}
-- Новый формат с поддержкой WhatsApp форматирования

-- Обновляем дефолтные значения для новых записей
ALTER TABLE consultation_notification_settings
    ALTER COLUMN confirmation_template SET DEFAULT '*{{#client_name}}{{client_name}}, {{/client_name}}подтверждаем запись:*

*Дата:* {{date}}
*Время:* {{time}}{{#service_name}}
*Услуга:* {{service_name}}{{/service_name}}

*PERFORMANTE AI AGENCY*
Увеличиваем прибыль при помощи ИИ';

ALTER TABLE consultation_notification_settings
    ALTER COLUMN reminder_24h_template SET DEFAULT '*{{#client_name}}{{client_name}}, {{/client_name}}напоминаем о Вашей онлайн консультации завтра:*

*Дата:* {{date}}
*Время:* {{time}}{{#service_name}}
*Услуга:* {{service_name}}{{/service_name}}

*PERFORMANTE AI AGENCY*
Увеличиваем прибыль при помощи ИИ';

ALTER TABLE consultation_notification_settings
    ALTER COLUMN reminder_1h_template SET DEFAULT '*{{#client_name}}{{client_name}}, {{/client_name}}напоминаем Вам об онлайн консультации, маркетолог скоро свяжется с вами:*

*Дата:* {{date}}
*Время:* {{time}}{{#service_name}}
*Услуга:* {{service_name}}{{/service_name}}

До Вашего визита осталось {{time_remaining}}
-------------------------------------------
*PERFORMANTE AI AGENCY*';

-- Обновляем существующие записи ТОЛЬКО если они используют старые дефолтные шаблоны
-- (т.е. пользователь их не менял)
UPDATE consultation_notification_settings
SET confirmation_template = '*{{#client_name}}{{client_name}}, {{/client_name}}подтверждаем запись:*

*Дата:* {{date}}
*Время:* {{time}}{{#service_name}}
*Услуга:* {{service_name}}{{/service_name}}

*PERFORMANTE AI AGENCY*
Увеличиваем прибыль при помощи ИИ'
WHERE confirmation_template = 'Здравствуйте{{#client_name}}, {{client_name}}{{/client_name}}! Вы записаны на консультацию {{date}} в {{time}}. До встречи!';

UPDATE consultation_notification_settings
SET reminder_24h_template = '*{{#client_name}}{{client_name}}, {{/client_name}}напоминаем о Вашей онлайн консультации завтра:*

*Дата:* {{date}}
*Время:* {{time}}{{#service_name}}
*Услуга:* {{service_name}}{{/service_name}}

*PERFORMANTE AI AGENCY*
Увеличиваем прибыль при помощи ИИ'
WHERE reminder_24h_template = 'Напоминаем о вашей консультации завтра {{date}} в {{time}}. Ждём вас!';

UPDATE consultation_notification_settings
SET reminder_1h_template = '*{{#client_name}}{{client_name}}, {{/client_name}}напоминаем Вам об онлайн консультации, маркетолог скоро свяжется с вами:*

*Дата:* {{date}}
*Время:* {{time}}{{#service_name}}
*Услуга:* {{service_name}}{{/service_name}}

До Вашего визита осталось {{time_remaining}}
-------------------------------------------
*PERFORMANTE AI AGENCY*'
WHERE reminder_1h_template = 'Через час у вас консультация в {{time}}. До скорой встречи!';

COMMENT ON COLUMN consultation_notification_settings.confirmation_template IS 'Шаблон подтверждения записи. Переменные: {{client_name}}, {{date}}, {{time}}, {{consultant_name}}, {{service_name}}';
COMMENT ON COLUMN consultation_notification_settings.reminder_24h_template IS 'Шаблон напоминания за 24 часа. Переменные: {{client_name}}, {{date}}, {{time}}, {{consultant_name}}, {{service_name}}, {{time_remaining}}';
COMMENT ON COLUMN consultation_notification_settings.reminder_1h_template IS 'Шаблон напоминания за 1 час. Переменные: {{client_name}}, {{date}}, {{time}}, {{consultant_name}}, {{service_name}}, {{time_remaining}}';
