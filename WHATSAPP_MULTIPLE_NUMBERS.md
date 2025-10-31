# WhatsApp: Множественные номера с привязкой к направлениям

## Обзор изменений

Реализована возможность добавлять несколько WhatsApp номеров и привязывать их к конкретным направлениям бизнеса.

### Было ❌
- Один номер WhatsApp в `user_accounts.whatsapp_phone_number`
- Все ad sets всех направлений используют один номер

### Стало ✅
- Несколько номеров WhatsApp в таблице `whatsapp_phone_numbers`
- Каждое направление может иметь свой номер
- Fallback на дефолтный номер или старый из `user_accounts`

---

## Структура БД

### Новая таблица: `whatsapp_phone_numbers`

```sql
CREATE TABLE whatsapp_phone_numbers (
  id UUID PRIMARY KEY,
  user_account_id UUID FK → user_accounts(id),
  phone_number TEXT NOT NULL,  -- формат: +12345678901
  label TEXT,                   -- например: "Основной", "Для клиник"
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Ограничения:**
- Номер уникален в пределах пользователя
- Только один `is_default=true` на пользователя (автоматически)
- Формат номера: международный `+[код страны][номер]`

### Обновление: `account_directions`

Добавлена колонка:
```sql
whatsapp_phone_number_id UUID FK → whatsapp_phone_numbers(id)
```

**Логика:**
- `NULL` → использовать дефолтный номер или из `user_accounts`
- Указан ID → использовать этот конкретный номер

---

## Миграция

### 1. Применить SQL миграцию

```bash
# Выполнить в Supabase SQL Editor
cat migrations/012_whatsapp_phone_numbers_table.sql
```

**Что произойдет:**
1. ✅ Создастся таблица `whatsapp_phone_numbers`
2. ✅ Добавится колонка `whatsapp_phone_number_id` в `account_directions`
3. ✅ Существующие номера из `user_accounts` автоматически мигрируют
4. ✅ Создадутся триггеры и индексы

### 2. Проверка миграции

```sql
-- Проверить создание таблицы
SELECT * FROM whatsapp_phone_numbers;

-- Проверить миграцию существующих номеров
SELECT 
  ua.id as user_id,
  ua.username,
  ua.whatsapp_phone_number as old_number,
  wpn.phone_number as new_number,
  wpn.is_default
FROM user_accounts ua
LEFT JOIN whatsapp_phone_numbers wpn ON wpn.user_account_id = ua.id
WHERE ua.whatsapp_phone_number IS NOT NULL;

-- Проверить колонку в directions
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'account_directions' 
  AND column_name = 'whatsapp_phone_number_id';
```

---

## API Endpoints

### 1. GET `/api/whatsapp-numbers`

Получить список WhatsApp номеров пользователя.

**Query:**
- `userAccountId` (UUID, required)

**Response:**
```json
{
  "numbers": [
    {
      "id": "uuid",
      "phone_number": "+12345678901",
      "label": "Основной",
      "is_default": true,
      "is_active": true,
      "created_at": "2025-10-24T12:00:00Z"
    }
  ]
}
```

### 2. POST `/api/whatsapp-numbers`

Добавить новый номер.

**Body:**
```json
{
  "userAccountId": "uuid",
  "phone_number": "+12345678901",
  "label": "Для клиник",
  "is_default": false
}
```

### 3. PUT `/api/whatsapp-numbers/:id`

Обновить номер (label, is_default, is_active).

### 4. DELETE `/api/whatsapp-numbers/:id`

Удалить номер (если не используется в направлениях).

### 5. GET `/api/directions` (обновлен)

Теперь возвращает `whatsapp_phone_number` вместе с другими полями:

```json
{
  "directions": [
    {
      "id": "uuid",
      "name": "Имплантация",
      "whatsapp_phone_number_id": "uuid",
      "whatsapp_phone_number": "+12345678901"
    }
  ]
}
```

---

## Фронтенд изменения

### 1. Новый компонент: WhatsAppNumbersManager

**Файл:** `src/components/profile/WhatsAppNumbersManager.tsx`

**Функциональность:**
- Список всех номеров пользователя
- Добавление нового номера
- Редактирование label
- Установка дефолтного номера
- Удаление номера (с проверкой использования)

### 2. Обновление: CreateDirectionDialog

**Файл:** `src/components/profile/CreateDirectionDialog.tsx`

**Добавлено:**
- Select для выбора WhatsApp номера
- Опция "Использовать дефолтный"
- Отображение текущего номера

### 3. Обновление: DirectionsCard

**Файл:** `src/components/profile/DirectionsCard.tsx`

**Добавлено:**
- Отображение WhatsApp номера в карточке направления
- Иконка WhatsApp
- Возможность изменить номер при редактировании

---

## Бэкенд изменения

### 1. Новый API: whatsappNumbers.ts

**Файл:** `services/agent-service/src/routes/whatsappNumbers.ts`

CRUD endpoints для управления номерами.

### 2. Обновление: directions.ts

**Файл:** `services/agent-service/src/routes/directions.ts`

**Изменения:**
- `GET /api/directions` - join с `whatsapp_phone_numbers`
- `POST /api/directions` - сохранение `whatsapp_phone_number_id`
- `PUT /api/directions/:id` - обновление номера

### 3. Обновление: workflows

**Файлы:**
- `src/workflows/createCampaignWithCreative.ts`
- `src/workflows/createAdSetInDirection.ts`

**Логика получения номера:**

```typescript
// 1. Приоритет: номер из direction
if (direction.whatsapp_phone_number_id) {
  const { data } = await supabase
    .from('whatsapp_phone_numbers')
    .select('phone_number')
    .eq('id', direction.whatsapp_phone_number_id)
    .single();
  
  whatsappNumber = data?.phone_number;
}

// 2. Fallback: дефолтный номер пользователя
if (!whatsappNumber) {
  const { data } = await supabase
    .from('whatsapp_phone_numbers')
    .select('phone_number')
    .eq('user_account_id', userAccountId)
    .eq('is_default', true)
    .single();
  
  whatsappNumber = data?.phone_number;
}

// 3. Fallback: старый номер из user_accounts
if (!whatsappNumber) {
  const { data } = await supabase
    .from('user_accounts')
    .select('whatsapp_phone_number')
    .eq('id', userAccountId)
    .single();
  
  whatsappNumber = data?.whatsapp_phone_number;
}

// 4. Финальный fallback: дефолт Facebook
if (!whatsappNumber) {
  whatsappNumber = null; // Facebook использует свой дефолтный
}
```

### 4. Обновление: Brain Agent

**Файл:** `services/agent-brain/src/server.js`

**Изменения:**
- При формировании actions для направления - передавать `whatsapp_phone_number` из direction
- Fallback на старую логику для обратной совместимости

---

## Обратная совместимость

### Старые направления (без whatsapp_phone_number_id)

Автоматически используют:
1. Дефолтный номер из `whatsapp_phone_numbers` (is_default=true)
2. Если нет - номер из `user_accounts.whatsapp_phone_number`
3. Если нет - дефолт Facebook

### Старая колонка user_accounts.whatsapp_phone_number

**НЕ удаляется!** Используется для:
- Обратной совместимости
- Fallback если нет записей в новой таблице
- Миграции при первом запуске

---

## Тестирование

### 1. Миграция данных

```sql
-- Проверить что старые номера мигрировали
SELECT 
  COUNT(*) as total_migrated
FROM whatsapp_phone_numbers
WHERE label = 'Основной';
```

### 2. Создание направления

1. Добавьте несколько номеров в профиле
2. Создайте направление
3. Выберите конкретный номер
4. Проверьте что сохранилось: `SELECT whatsapp_phone_number_id FROM account_directions WHERE id = ...`

### 3. Автозапуск кампании

1. Создайте направление с конкретным номером
2. Запустите автозапуск
3. Проверьте созданный ad set в Facebook:
   - Должен использовать номер из направления
   - `promoted_object.whatsapp_phone_number` должен совпадать

### 4. Brain Agent

1. Запустите brain для пользователя с направлениями
2. Проверьте логи: какой номер используется для каждого действия
3. Убедитесь что номера разные для разных направлений

---

## Деплой

### 1. База данных

```bash
# Выполнить миграцию в Supabase
```

### 2. Бэкенд (agent-service)

```bash
cd services/agent-service
# Проверить изменения
git diff src/routes/directions.ts
git diff src/workflows/

# Перезапустить сервис
docker compose restart agent-service
```

### 3. Фронтенд

```bash
cd services/frontend
# Проверить новые компоненты
ls src/components/profile/WhatsAppNumbersManager.tsx

# Пересобрать
docker compose restart frontend
```

### 4. Brain Agent

```bash
# Перезапустить brain
docker compose restart agent-brain
```

---

## Rollback (если нужно)

### Откат миграции

```sql
-- Удалить колонку из directions
ALTER TABLE account_directions DROP COLUMN IF EXISTS whatsapp_phone_number_id;

-- Удалить таблицу
DROP TABLE IF EXISTS whatsapp_phone_numbers CASCADE;
```

### Откат кода

```bash
git revert <commit-hash>
docker compose restart agent-service agent-brain frontend
```

---

## FAQ

**Q: Что если удалить номер, который используется в направлениях?**
A: Колонка имеет `ON DELETE SET NULL` - направление переключится на дефолтный номер.

**Q: Можно ли иметь направления без номера?**
A: Да, `whatsapp_phone_number_id = NULL` означает "использовать дефолтный".

**Q: Что если у пользователя нет ни одного номера?**
A: Используется старый номер из `user_accounts` или дефолт Facebook.

**Q: Как работает is_default?**
A: Только один номер может быть дефолтным. При установке is_default=true, у остальных автоматически ставится false.

**Q: Нужно ли вручную мигрировать данные?**
A: Нет, миграция автоматическая. Все существующие номера из `user_accounts` создадутся в новой таблице.

---

## Roadmap (будущие улучшения)

1. ✅ Множественные номера (реализовано)
2. 🔜 Валидация номеров через WhatsApp Business API
3. 🔜 История использования номера (какие кампании)
4. 🔜 Автоматическое переключение если номер недоступен
5. 🔜 Статистика по номерам (расход, лиды)





