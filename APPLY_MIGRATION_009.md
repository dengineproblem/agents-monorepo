# Применение миграции 009_add_manual_send_field.sql

## ⚠️ Важно!

Эта миграция добавляет поддержку ручной отправки кампаний. Необходимо применить её в Supabase.

## 📋 Что добавляет миграция:

1. **Новое поле** `manual_send_requested_at` в таблице `campaign_messages`
2. **Индексы** для эффективных запросов
3. **Комментарии** для документации

## 🚀 Как применить:

### Вариант 1: Через Supabase Dashboard (рекомендуется)

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard)
2. Выберите проект
3. Перейдите в **SQL Editor**
4. Скопируйте содержимое файла `services/crm-backend/migrations/009_add_manual_send_field.sql`
5. Вставьте в редактор
6. Нажмите **Run**

### Вариант 2: Через Supabase CLI

```bash
# Если у вас установлен Supabase CLI
supabase db push
```

### Вариант 3: Вручную через psql (если есть прямой доступ)

```bash
psql -h <supabase-host> -U postgres -d postgres < services/crm-backend/migrations/009_add_manual_send_field.sql
```

## ✅ Проверка применения:

После применения миграции выполните:

```sql
-- Проверить наличие поля
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'campaign_messages' 
  AND column_name = 'manual_send_requested_at';

-- Проверить индексы
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'campaign_messages' 
  AND indexname LIKE '%manual%';
```

Должны вернуться результаты:
- Поле `manual_send_requested_at` типа `timestamp with time zone`
- Индекс `idx_campaign_messages_manual_send`

## 📝 Содержимое миграции:

```sql
-- Add field to track manual send requests
ALTER TABLE campaign_messages 
ADD COLUMN IF NOT EXISTS manual_send_requested_at TIMESTAMPTZ NULL;

-- Add index for efficient querying of manual send requests
CREATE INDEX IF NOT EXISTS idx_campaign_messages_manual_send 
ON campaign_messages(user_account_id, manual_send_requested_at) 
WHERE manual_send_requested_at IS NOT NULL;

-- Add index for pending/scheduled messages
CREATE INDEX IF NOT EXISTS idx_campaign_messages_status_user 
ON campaign_messages(user_account_id, status, created_at);

COMMENT ON COLUMN campaign_messages.manual_send_requested_at IS 
'Timestamp when user manually requested to send this queue. Used to prioritize manual sends over autopilot.';
```

## 🔧 Откат (если нужно):

```sql
-- Удалить поле
ALTER TABLE campaign_messages 
DROP COLUMN IF EXISTS manual_send_requested_at;

-- Удалить индексы
DROP INDEX IF EXISTS idx_campaign_messages_manual_send;
DROP INDEX IF EXISTS idx_campaign_messages_status_user;
```

## 📚 Связанные документы:

- `MANUAL_SEND_FEATURE.md` - полная документация функции
- `CAMPAIGN_AUTOMATION_FLOW.md` - общая документация по кампаниям


