# Database Migrations

## Применение миграций

### Способ 1: Через Supabase Dashboard (рекомендуется для MVP)

1. Открыть [Supabase Dashboard](https://app.supabase.com)
2. Выбрать проект `ikywuvtavpnjlrjtalqi`
3. Перейти в SQL Editor
4. Скопировать содержимое файла `001_add_campaign_fields.sql`
5. Выполнить SQL запрос
6. Проверить что все таблицы и поля созданы

### Способ 2: Через psql (для production)

```bash
# Подключиться к Supabase PostgreSQL
psql "postgresql://postgres:[PASSWORD]@db.ikywuvtavpnjlrjtalqi.supabase.co:5432/postgres"

# Выполнить миграцию
\i services/crm-backend/migrations/001_add_campaign_fields.sql
```

## Список миграций

- `001_add_campaign_fields.sql` - Добавление полей для кампаний, создание таблиц campaign_templates, campaign_messages, campaign_settings

## Проверка применения

```sql
-- Проверить что новые поля добавлены в dialog_analysis
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'dialog_analysis' 
  AND column_name IN ('autopilot_enabled', 'last_campaign_message_at', 'campaign_messages_count', 'reactivation_score', 'audio_transcripts', 'manual_notes');

-- Проверить что таблицы созданы
SELECT table_name 
FROM information_schema.tables 
WHERE table_name IN ('campaign_templates', 'campaign_messages', 'campaign_settings');

-- Проверить настройки по умолчанию для тестового пользователя
SELECT * FROM campaign_settings WHERE user_account_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';
```

