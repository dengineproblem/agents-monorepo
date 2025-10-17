# Исправление: Направления работают с Supabase

## 🔧 Что было исправлено

### Проблема
Фронтенд обращался к несуществующему API `http://localhost:3000/api/directions`, но данные хранятся в Supabase таблице `account_directions`.

### Решение

#### 1. **Переписан API сервис** (`/src/services/directionsApi.ts`)

**Было:**
- Обращения к внешнему API через `fetch()`
- Endpoint: `http://localhost:3000/api/directions`

**Стало:**
- Прямая работа с Supabase через `supabase.from('account_directions')`
- Все CRUD операции теперь работают напрямую с БД

#### 2. **Добавлена миграция** (`add_objective_to_account_directions.sql`)

В таблице `account_directions` отсутствовала критически важная колонка `objective`, которая хранит тип кампании.

**Что добавляет миграция:**
```sql
ALTER TABLE account_directions 
ADD COLUMN objective TEXT NOT NULL DEFAULT 'whatsapp' 
CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads'));
```

---

## ⚡ Что нужно сделать

### 1. **Выполнить SQL миграцию**

Запустите в Supabase SQL Editor:
```bash
\i add_objective_to_account_directions.sql
```

Или скопируйте содержимое файла `add_objective_to_account_directions.sql` и выполните в SQL редакторе Supabase.

### 2. **Обновить существующие записи (если есть)**

Если у вас уже есть направления без `objective`, установите для них значение по умолчанию:

```sql
-- Для существующих направлений устанавливаем whatsapp (если нет значения)
UPDATE account_directions 
SET objective = 'whatsapp'
WHERE objective IS NULL;
```

### 3. **Проверить RLS политики**

Убедитесь, что в Supabase настроены RLS политики для таблицы `account_directions`:

```sql
-- Просмотр политик
SELECT * FROM pg_policies WHERE tablename = 'account_directions';

-- Если политик нет, создаём:
ALTER TABLE account_directions ENABLE ROW LEVEL SECURITY;

-- Политика на чтение
CREATE POLICY "Users can view own directions" 
ON account_directions FOR SELECT 
USING (user_account_id = auth.uid());

-- Политика на создание
CREATE POLICY "Users can create own directions" 
ON account_directions FOR INSERT 
WITH CHECK (user_account_id = auth.uid());

-- Политика на обновление
CREATE POLICY "Users can update own directions" 
ON account_directions FOR UPDATE 
USING (user_account_id = auth.uid());

-- Политика на удаление
CREATE POLICY "Users can delete own directions" 
ON account_directions FOR DELETE 
USING (user_account_id = auth.uid());
```

---

## ✅ Проверка работы

1. Откройте `/profile` (Личный кабинет)
2. Найдите карточку "Направления бизнеса"
3. Если у вас уже были направления - они должны отобразиться
4. Попробуйте создать новое направление
5. Проверьте редактирование и удаление

---

## 🔍 Отладка

### Если направления не отображаются:

1. **Откройте консоль браузера (F12)**
2. Посмотрите на ошибки:
   - ❌ `relation "account_directions" does not exist` → таблица не создана, выполните `migrate_account_directions.sql`
   - ❌ `column "objective" does not exist` → выполните `add_objective_to_account_directions.sql`
   - ❌ `row-level security policy violation` → проверьте RLS политики

3. **Проверьте данные в Supabase:**
```sql
-- Посмотреть все направления
SELECT * FROM account_directions;

-- Посмотреть направления конкретного пользователя
SELECT * FROM account_directions 
WHERE user_account_id = 'ваш-uuid-пользователя';
```

4. **Проверьте ID пользователя:**
```javascript
// В консоли браузера
const user = JSON.parse(localStorage.getItem('user'));
console.log('User ID:', user?.id);
```

---

## 📋 Структура таблицы account_directions

После миграции таблица должна иметь следующие колонки:

| Колонка | Тип | Обязательная | Default | Описание |
|---------|-----|--------------|---------|----------|
| `id` | UUID | ✅ | gen_random_uuid() | Первичный ключ |
| `user_account_id` | UUID | ✅ | - | FK → user_accounts(id) |
| `name` | TEXT | ✅ | - | Название направления (2-100 символов) |
| `objective` | TEXT | ✅ | 'whatsapp' | Тип кампании |
| `fb_campaign_id` | TEXT | ❌ | NULL | ID кампании в Facebook |
| `campaign_status` | TEXT | ❌ | 'PAUSED' | Статус кампании FB |
| `daily_budget_cents` | INTEGER | ✅ | 1000 | Суточный бюджет в центах (≥$10) |
| `target_cpl_cents` | INTEGER | ✅ | 50 | Целевой CPL в центах (≥$0.50) |
| `is_active` | BOOLEAN | ✅ | true | Активно ли направление |
| `created_at` | TIMESTAMPTZ | ✅ | NOW() | Дата создания |
| `updated_at` | TIMESTAMPTZ | ✅ | NOW() | Дата обновления |

---

## 🎯 Теперь работает:

- ✅ Чтение направлений из Supabase
- ✅ Создание новых направлений
- ✅ Обновление направлений
- ✅ Удаление направлений
- ✅ Фильтрация по `user_account_id`
- ✅ Сортировка по дате создания (новые сверху)
- ✅ Валидация типа кампании (objective)

---

**Дата исправления:** 12 октября 2025

