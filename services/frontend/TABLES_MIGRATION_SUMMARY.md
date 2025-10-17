# Резюме: Миграции таблиц account_directions
**Дата:** 11 октября 2025  
**Начало проблемы:** Ошибка при выполнении миграции

---

## 🚨 ИСХОДНАЯ ПРОБЛЕМА

```
ERROR: column "fb_campaign_id" does not exist
LINE 42: CREATE INDEX IF NOT EXISTS idx_account_directions_campaign 
         ON account_directions(fb_campaign_id) 
         WHERE fb_campaign_id IS NOT NULL;
```

**Причина:** Таблица `account_directions` уже существовала БЕЗ колонки `fb_campaign_id`. `CREATE TABLE IF NOT EXISTS` пропускает создание, но индекс пытается использовать несуществующую колонку.

---

## ✅ РЕШЕНИЕ 1: Миграция account_directions (ВЫПОЛНЕНО)

**Файл:** `migrate_account_directions.sql`

### Подход:
Вместо `CREATE TABLE IF NOT EXISTS` с полным набором колонок:
1. Создаём минимальную таблицу
2. Проверяем КАЖДУЮ колонку через `information_schema.columns`
3. Добавляем через `ALTER TABLE ADD COLUMN IF NOT EXISTS`

### Таблица: account_directions

**Колонки:**
- `id` UUID PRIMARY KEY
- `user_account_id` UUID FK → user_accounts
- `name` TEXT NOT NULL (длина 2-100)
- `fb_campaign_id` TEXT
- `campaign_status` TEXT DEFAULT 'PAUSED' (ACTIVE/PAUSED/ARCHIVED/DELETED)
- `daily_budget_cents` INTEGER NOT NULL DEFAULT 1000 (минимум $10)
- `target_cpl_cents` INTEGER NOT NULL DEFAULT 50 (минимум $0.50)
- `is_active` BOOLEAN DEFAULT true
- `created_at`, `updated_at` TIMESTAMPTZ

**Связи:**
- `user_creatives.direction_id` UUID FK → account_directions(id)

**Триггеры:**
1. Обновление `updated_at`
2. Проверка максимум 5 активных направлений

**RLS политики:**
```sql
user_account_id = auth.uid()  -- прямое сравнение
```

**Проблемы при миграции:**
1. ❌ `column daily_budget_cents does not exist` → Добавил проверки для ВСЕХ колонок
2. ❌ `column user_accounts.user_id does not exist` → Изменил на `auth.uid()` напрямую
3. ❌ `syntax error at or near "-"` → Неполное копирование SQL

**Статус:** ✅ Миграция выполнена успешно

---

## ✅ РЕШЕНИЕ 2: Логика лимитов бюджета (НЕ ВЫПОЛНЕНО)

**Файл:** `add_budget_limits_logic.sql`

### Концепция:
```
user_accounts.daily_budget_cents = МАКС для всех направлений
Σ account_directions.daily_budget_cents (active) ≤ user_accounts.daily_budget_cents
```

### Что добавляет:

**1. Триггер проверки лимита:**
```sql
CREATE TRIGGER trigger_check_budget_limit
BEFORE INSERT OR UPDATE ON account_directions
```
Выбрасывает ошибку если превышен лимит аккаунта.

**2. Функция `get_available_budget(user_id)`:**
Возвращает:
- `total_limit_cents` - общий лимит
- `used_budget_cents` - использовано направлениями
- `available_budget_cents` - остаток
- `active_directions_count` - количество активных

**3. View `v_budget_allocation`:**
Аналитика распределения бюджета в %.

**Статус:** ⚠️ Файл создан, миграция НЕ выполнена в БД

---

## ❌ ПРОБЛЕМА 3: Неправильная миграция синхронизации

**Файл:** `sync_direction_with_facebook.sql`

**Идея:** При изменении `is_active` автоматически останавливать/запускать FB кампанию через триггер + pg_net.

**Что было сделано:**
- Триггер `trigger_sync_direction_with_facebook`
- Функции `sync_direction_status_with_facebook()`, `toggle_direction_status()`, `log_direction_sync()`
- Таблица `direction_sync_log`
- Попытка использовать расширение `pg_net`

**Проблема:** Миграция была выполнена, но оказалась неправильной.

**Статус:** ❌ ТРЕБУЕТ ОТКАТА

---

## 🔄 ОТКАТ: rollback_sync_direction_with_facebook.sql

**Файл для отката:** `rollback_sync_direction_with_facebook.sql`

**Что удаляет:**
```sql
DROP TRIGGER IF EXISTS trigger_sync_direction_with_facebook;
DROP FUNCTION IF EXISTS sync_direction_status_with_facebook();
DROP FUNCTION IF EXISTS toggle_direction_status(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS log_direction_sync(...);
DROP TABLE IF EXISTS direction_sync_log CASCADE;
-- DROP EXTENSION IF EXISTS pg_net; -- опционально
```

**Статус:** ⚠️ Файл создан, НУЖНО ВЫПОЛНИТЬ

---

## 📁 ФАЙЛЫ

1. ✅ `migrate_account_directions.sql` - основная миграция (213 строк, выполнена)
2. ⚠️ `add_budget_limits_logic.sql` - логика лимитов (не выполнена)
3. ❌ `sync_direction_with_facebook.sql` - синхронизация с FB (требует отката, 209 строк)
4. ✅ `rollback_sync_direction_with_facebook.sql` - откат (33 строки, нужно выполнить)

---

## 🎯 ДЕЙСТВИЯ ДЛЯ АГЕНТА

### Немедленно:
1. ❗ **Выполнить откат:** `rollback_sync_direction_with_facebook.sql`
2. ✅ **Опционально:** Выполнить `add_budget_limits_logic.sql` если нужна логика лимитов

### Переделать:
3. 🔄 **Синхронизацию is_active с Facebook** - упрощённый вариант:
   - Без pg_net
   - Без триггеров
   - Через фронтенд: чекбокс → API call → Facebook

---

## 💡 ВАЖНО

1. **RLS политика:** `user_account_id = auth.uid()` (колонка называется `id`, не `user_id`)
2. **Минимальные значения:**
   - `daily_budget_cents >= 1000` ($10)
   - `target_cpl_cents >= 50` ($0.50)
3. **Лимит:** Максимум 5 активных направлений на пользователя
4. **При копировании SQL:** Копировать ВЕСЬ файл с начала до конца

---

**Конец резюме**

