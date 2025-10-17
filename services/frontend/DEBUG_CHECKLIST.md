# Чеклист для отладки проблемы с направлениями

## Шаг 1: Откройте консоль браузера (F12)

1. Перейдите на страницу `/profile` (Личный кабинет)
2. Откройте вкладку Console
3. Найдите логи с префиксом `[DirectionsCard]` и `[directionsApi.list]`

### Что проверить:

**A. User Account ID**
```
[DirectionsCard] userAccountId: "12345678-1234-1234-1234-123456789abc"
```
- ✅ Должен быть UUID
- ❌ Если `null` или `undefined` - проблема с авторизацией

**B. Запрос к Supabase**
```
[directionsApi.list] Запрос направлений для user_account_id: "12345678..."
```

**C. Результат запроса**
```
[directionsApi.list] Результат запроса: { data: [...], error: null }
```
- Если `data: []` - в базе нет направлений для этого пользователя
- Если `error: {...}` - ошибка запроса к базе

**D. Количество найденных направлений**
```
[directionsApi.list] Найдено направлений: 3
```

---

## Шаг 2: Проверьте данные в Supabase

Выполните SQL скрипт `debug_directions.sql` в Supabase SQL Editor.

### Что проверить:

**A. Есть ли колонка `objective`?**
```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'account_directions' AND column_name = 'objective';
```
- ✅ Должна вернуться строка `objective`
- ❌ Если пусто - выполните `add_objective_to_account_directions.sql`

**B. Есть ли данные в таблице?**
```sql
SELECT COUNT(*) FROM account_directions;
```
- Если 0 - в базе вообще нет направлений
- Если >0 - данные есть, проблема с фильтрацией

**C. Какой `user_account_id` у ваших направлений?**
```sql
SELECT user_account_id, name FROM account_directions LIMIT 5;
```
Сравните с ID из консоли браузера (Шаг 1A)

**D. Включен ли RLS?**
```sql
SELECT rowsecurity FROM pg_tables WHERE tablename = 'account_directions';
```
- `true` - RLS включен (проверьте политики)
- `false` - RLS выключен (данные должны быть доступны)

---

## Шаг 3: Проверьте соответствие ID

### В браузере (Console):
```javascript
const user = JSON.parse(localStorage.getItem('user'));
console.log('Frontend User ID:', user?.id);
```

### В Supabase (SQL):
```sql
SELECT id, username, email FROM user_accounts WHERE email = 'ваш@email.com';
```

### В таблице направлений (SQL):
```sql
SELECT user_account_id, name FROM account_directions;
```

**Все три ID должны совпадать!**

---

## Возможные проблемы и решения

### Проблема 1: `user_account_id` не совпадает

**Симптом:**
- В консоли: `userAccountId: "aaa-bbb-ccc"`
- В базе: `user_account_id: "xxx-yyy-zzz"`

**Решение:**
```sql
-- Обновите user_account_id у направлений
UPDATE account_directions 
SET user_account_id = 'ПРАВИЛЬНЫЙ-UUID-ИЗ-КОНСОЛИ'
WHERE user_account_id = 'СТАРЫЙ-UUID';
```

---

### Проблема 2: Колонка `objective` отсутствует

**Симптом:**
```
[directionsApi.list] Ошибка: column "objective" does not exist
```

**Решение:**
Выполните миграцию:
```sql
ALTER TABLE account_directions 
ADD COLUMN objective TEXT NOT NULL DEFAULT 'whatsapp' 
CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads'));
```

---

### Проблема 3: RLS блокирует доступ

**Симптом:**
- В консоли: `data: [], error: null` (нет ошибки, но пустой массив)
- В SQL (без RLS): данные есть

**Решение:**
```sql
-- Проверьте текущего пользователя
SELECT auth.uid();

-- Если NULL - проблема с авторизацией Supabase
-- Попробуйте временно отключить RLS для тестирования:
ALTER TABLE account_directions DISABLE ROW LEVEL SECURITY;

-- После проверки ОБЯЗАТЕЛЬНО включите обратно:
ALTER TABLE account_directions ENABLE ROW LEVEL SECURITY;
```

---

### Проблема 4: Направления созданы через другую таблицу

**Симптом:**
- Видите данные в таблице, но не в той

**Проверка:**
```sql
-- Проверьте все таблицы с "direction" в названии
SELECT table_name 
FROM information_schema.tables 
WHERE table_name LIKE '%direction%';
```

Возможные таблицы:
- `account_directions` ✅ (правильная)
- `user_directions` ❌ (старая, если есть - смотри ниже)

**Если данные в `user_directions`:**
```sql
-- Перенесите данные
INSERT INTO account_directions (user_account_id, name, objective, daily_budget_cents, target_cpl_cents)
SELECT 
    user_id,
    main_direction,
    'whatsapp',  -- по умолчанию
    5000,        -- $50
    200          -- $2.00
FROM user_directions;
```

---

## Быстрый тест

Создайте тестовое направление напрямую в Supabase:

```sql
-- Узнайте свой ID
SELECT id, email FROM user_accounts WHERE email = 'ваш@email.com';

-- Создайте тестовое направление
INSERT INTO account_directions (
    user_account_id, 
    name, 
    objective, 
    daily_budget_cents, 
    target_cpl_cents,
    is_active
) VALUES (
    'ВАШ-UUID-ИЗ-ПРЕДЫДУЩЕГО-ЗАПРОСА',
    'Тестовое направление',
    'whatsapp',
    5000,
    200,
    true
);

-- Проверьте
SELECT * FROM account_directions 
WHERE user_account_id = 'ВАШ-UUID';
```

Обновите страницу `/profile` - тестовое направление должно появиться.

---

## Что писать в ответ

После выполнения шагов напишите:

1. **Что показывает консоль браузера** (скопируйте логи)
2. **Результат SQL запроса** `SELECT * FROM account_directions LIMIT 3`
3. **Совпадают ли ID** (из браузера и из базы)
4. **Есть ли колонка objective** (да/нет)

Это поможет точно определить проблему! 🔍

