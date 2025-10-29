# 📋 Инструкции по выполнению миграций в Supabase

## Шаг 1: Открой Supabase SQL Editor

1. Перейди на [supabase.com](https://supabase.com)
2. Открой свой проект
3. В левом меню выбери **SQL Editor**
4. Нажми **New query**

## Шаг 2: Выполни миграции по порядку

### Migration 013: Добавление полей для directions и креативов

**Файл:** `migrations/013_add_direction_creative_to_leads.sql`

**Что делает:**
- Добавляет `direction_id`, `creative_id`, `whatsapp_phone_number_id`, `user_account_id` в таблицу `leads`
- Создает индексы для быстрых запросов
- Добавляет trigger для автоматического обновления `updated_at`

**Выполнить:**
1. Открой файл `migrations/013_add_direction_creative_to_leads.sql`
2. Скопируй весь контент (Cmd+A, Cmd+C)
3. Вставь в Supabase SQL Editor
4. Нажми **Run** (или Cmd+Enter)

**Ожидаемый результат:**
```
Success. No rows returned
```

---

### Migration 014: Создание таблицы whatsapp_instances

**Файл:** `migrations/014_create_whatsapp_instances_table.sql`

**Что делает:**
- Создает таблицу `whatsapp_instances` для хранения Evolution API instances
- Добавляет индексы и constraints
- Создает trigger для `updated_at`

**Выполнить:**
1. Открой файл `migrations/014_create_whatsapp_instances_table.sql`
2. Скопируй весь контент
3. Вставь в новую вкладку SQL Editor
4. Нажми **Run**

**Ожидаемый результат:**
```
Success. No rows returned
```

---

### Migration 015: Улучшение таблицы messages_ai_target

**Файл:** `migrations/015_enhance_messages_table.sql`

**Что делает:**
- Добавляет поля `instance_id`, `source_id`, `creative_id`, `direction_id`, `lead_id`, `raw_data` в `messages_ai_target`
- Создает индексы
- Добавляет GIN index для JSONB поля `raw_data`

**Выполнить:**
1. Открой файл `migrations/015_enhance_messages_table.sql`
2. Скопируй весь контент
3. Вставь в новую вкладку SQL Editor
4. Нажми **Run**

**Ожидаемый результат:**
```
Success. No rows returned
```

---

### Migration 016: Миграция существующих данных

**Файл:** `migrations/016_migrate_existing_leads_data.sql`

**Что делает:**
- Заполняет `whatsapp_phone_number_id` по `business_id`
- Пытается замапить `creative_url` на `user_creatives`
- Устанавливает `direction_id` из креативов
- Показывает статистику миграции
- Создает view `unmapped_leads` для ручной проверки

**Выполнить:**
1. Открой файл `migrations/016_migrate_existing_leads_data.sql`
2. Скопируй весь контент
3. Вставь в новую вкладку SQL Editor
4. Нажми **Run**

**Ожидаемый результат:**
```
NOTICE: Migration 016 Statistics:
NOTICE:   Total leads: 472
NOTICE:   Leads with direction_id: XXX (XX.X%)
NOTICE:   Leads with creative_id: XXX (XX.X%)
NOTICE:   Leads with whatsapp_phone_number_id: XXX (XX.X%)
NOTICE:   Leads with user_account_id: XXX (XX.X%)

Success. No rows returned
```

---

## Шаг 3: Проверка миграций

### Проверка структуры таблиц

```sql
-- Проверка новых полей в leads
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'leads'
AND column_name IN ('direction_id', 'creative_id', 'whatsapp_phone_number_id', 'user_account_id');
```

Ожидаемый результат:
```
direction_id             | uuid
creative_id              | uuid
whatsapp_phone_number_id | uuid
user_account_id          | uuid
```

### Проверка таблицы whatsapp_instances

```sql
SELECT * FROM whatsapp_instances LIMIT 1;
```

Если таблица пустая - это нормально (instances будут создаваться через API).

### Проверка unmapped leads

```sql
SELECT COUNT(*) FROM unmapped_leads;
```

Покажет количество лидов, которые не удалось автоматически замапить на креативы/directions.

---

## Шаг 4: Если что-то пошло не так

### Откат Migration 016 (миграция данных)

```sql
-- Очистить замапленные данные
UPDATE leads
SET
  direction_id = NULL,
  creative_id = NULL,
  whatsapp_phone_number_id = NULL,
  user_account_id = NULL
WHERE updated_at > NOW() - INTERVAL '10 minutes';

-- Удалить view
DROP VIEW IF EXISTS unmapped_leads;
```

### Откат Migration 015

```sql
-- Удалить добавленные поля
ALTER TABLE messages_ai_target
DROP COLUMN IF EXISTS instance_id,
DROP COLUMN IF EXISTS source_id,
DROP COLUMN IF EXISTS creative_id,
DROP COLUMN IF EXISTS direction_id,
DROP COLUMN IF EXISTS lead_id,
DROP COLUMN IF EXISTS raw_data;
```

### Откат Migration 014

```sql
-- Удалить таблицу и trigger
DROP TRIGGER IF EXISTS trigger_whatsapp_instances_updated_at ON whatsapp_instances;
DROP FUNCTION IF EXISTS update_whatsapp_instances_updated_at();
DROP TABLE IF EXISTS whatsapp_instances CASCADE;
```

### Откат Migration 013

```sql
-- Удалить добавленные поля и trigger
DROP TRIGGER IF EXISTS trigger_leads_updated_at ON leads;
DROP FUNCTION IF EXISTS update_leads_updated_at();

ALTER TABLE leads
DROP COLUMN IF EXISTS direction_id,
DROP COLUMN IF EXISTS creative_id,
DROP COLUMN IF EXISTS whatsapp_phone_number_id,
DROP COLUMN IF EXISTS user_account_id;
```

---

## ✅ Чеклист выполнения

- [ ] Migration 013 выполнена успешно
- [ ] Migration 014 выполнена успешно
- [ ] Migration 015 выполнена успешно
- [ ] Migration 016 выполнена успешно
- [ ] Проверена структура таблиц
- [ ] Проверено количество unmapped leads
- [ ] Все NOTICE сообщения прочитаны

---

## 📞 Что дальше?

После успешного выполнения миграций:

1. ✅ Добавь environment variables в `.env.agent` (см. EVOLUTION_API_ENV_SETUP.md)
2. ✅ Запусти Docker контейнеры (см. EVOLUTION_API_DEPLOYMENT.md)
3. ✅ Протестируй создание WhatsApp instance

---

**Дата создания:** 2025-10-28
**Автор:** Claude Code Assistant
