# Логика работы с WhatsApp номерами

## Обзор

WhatsApp номера добавляются **напрямую при создании направления**. Пользователь вводит номер в форму создания направления, и система автоматически сохраняет его.

## Как это работает

### 1. Создание направления с номером

Пользователь создает направление (objective = 'whatsapp') и **вводит WhatsApp номер в поле формы**:
- Поле "WhatsApp номер" — опциональное
- Формат: международный, например `+77001234567`
- Если не указан — будет использован дефолтный из Facebook

### 2. Автоматическая обработка на бэкенде

При создании направления backend:

```typescript
// 1. Получает номер из формы
const { whatsapp_phone_number } = input;

// 2. Проверяет, существует ли уже такой номер в базе
const existingNumber = await supabase
  .from('whatsapp_phone_numbers')
  .select('id')
  .eq('user_account_id', userAccountId)
  .eq('phone_number', phoneNumber)
  .maybeSingle();

// 3а. Если существует — использует его ID
if (existingNumber) {
  whatsapp_phone_number_id = existingNumber.id;
}

// 3б. Если не существует — создает новую запись
else {
  const newNumber = await supabase
    .from('whatsapp_phone_numbers')
    .insert({
      user_account_id: userAccountId,
      phone_number: phoneNumber,
      is_active: true,
      is_default: false,
    })
    .select('id')
    .single();
  
  whatsapp_phone_number_id = newNumber.id;
}

// 4. Сохраняет направление с привязкой к номеру
await supabase
  .from('account_directions')
  .insert({
    ...,
    whatsapp_phone_number_id: whatsapp_phone_number_id,
  });
```

### 3. Использование номера при создании ad set

Когда система создает ad set для направления, она использует fallback логику:

1. **Приоритет 1**: Номер из `direction.whatsapp_phone_number_id`
2. **Приоритет 2**: Дефолтный номер из Facebook Page (через Graph API)
3. **Приоритет 3**: Дефолтный номер из `whatsapp_phone_numbers` (где `is_default = true`)
4. **Приоритет 4**: Legacy номер из `user_accounts.whatsapp_phone_number`

**ВАЖНО:** Если ни один номер не найден, функция `getWhatsAppPhoneNumber()` возвращает `null` (не выбрасывает ошибку). В этом случае поле `whatsapp_phone_number` **не передается** в Facebook API, и Facebook автоматически использует дефолтный номер WhatsApp со страницы.

```typescript
// Пример из createAdSetInDirection.ts
let whatsappPhoneNumber: string | null = null;

// 1. Приоритет: номер из direction
if (direction.whatsapp_phone_number_id) {
  const { data: phoneData } = await supabase
    .from('whatsapp_phone_numbers')
    .select('phone_number')
    .eq('id', direction.whatsapp_phone_number_id)
    .single();
  
  if (phoneData) {
    whatsappPhoneNumber = phoneData.phone_number;
  }
}

// 2. Fallback: дефолтный номер
if (!whatsappPhoneNumber) {
  const { data: defaultPhone } = await supabase
    .from('whatsapp_phone_numbers')
    .select('phone_number')
    .eq('user_account_id', userAccount.id)
    .eq('is_default', true)
    .maybeSingle();
  
  if (defaultPhone) {
    whatsappPhoneNumber = defaultPhone.phone_number;
  }
}

// 3. Legacy fallback
if (!whatsappPhoneNumber && userAccount.whatsapp_phone_number) {
  whatsappPhoneNumber = userAccount.whatsapp_phone_number;
}

// 4. Если номер не найден - возвращаем null (не ошибку!)
// Facebook сам использует дефолтный номер со страницы
return whatsappPhoneNumber; // может быть null
```

### 4. Передача номера в Facebook API (Spread Operator)

При создании `promoted_object` для ad set используется **spread operator**, чтобы поле `whatsapp_phone_number` добавлялось только если номер найден:

```typescript
// В Creative Test, Manual Launch, Auto-Launch V2
const whatsapp_phone_number = await getWhatsAppPhoneNumber(direction, user_id, supabase) || undefined;

const promoted_object = {
  page_id: userAccount.page_id,
  ...(whatsapp_phone_number && { whatsapp_phone_number }) // Добавляется только если есть
};
```

**Почему это важно:**
- Если `whatsapp_phone_number` === `null` или `undefined` → поле НЕ добавляется в объект
- Facebook получает `promoted_object` без поля `whatsapp_phone_number`
- Facebook автоматически использует дефолтный WhatsApp номер настроенный на странице

### 5. КРИТИЧЕСКОЕ: destination_type для WhatsApp кампаний

**ВАЖНО:** Для всех ad sets с `optimization_goal: 'CONVERSATIONS'` **ОБЯЗАТЕЛЬНО** должно быть указано `destination_type: 'WHATSAPP'`, **независимо от наличия whatsapp_phone_number**.

```typescript
// В campaignBuilder.ts createAdSetInCampaign()
if (optimization_goal === 'CONVERSATIONS') {
  body.destination_type = 'WHATSAPP'; // ВСЕГДА добавляем!
}

if (promoted_object) {
  body.promoted_object = promoted_object; // может содержать или не содержать whatsapp_phone_number
}
```

**Баг который был исправлен (2025-10-30):**
Ранее `destination_type` добавлялся только если `promoted_object?.whatsapp_phone_number` существует:
```typescript
// НЕПРАВИЛЬНО (старый код):
if (optimization_goal === 'CONVERSATIONS' && promoted_object?.whatsapp_phone_number) {
  body.destination_type = 'WHATSAPP';
}
```

Это вызывало ошибку Facebook API: **"Invalid parameter - optimization_goal недоступна"**, потому что `CONVERSATIONS` требует `destination_type: 'WHATSAPP'` даже без явно указанного номера.
```

## Структура базы данных

### Таблица `whatsapp_phone_numbers`

```sql
CREATE TABLE whatsapp_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL UNIQUE,
  label TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Таблица `account_directions`

```sql
ALTER TABLE account_directions
ADD COLUMN whatsapp_phone_number_id UUID 
  REFERENCES whatsapp_phone_numbers(id) ON DELETE SET NULL;
```

## Преимущества подхода

1. **Простота для пользователя**: не нужно заранее добавлять номера в профиль
2. **Автоматическое переиспользование**: при повторном вводе того же номера не создается дубликат
3. **Обратная совместимость**: legacy номер из `user_accounts` продолжает работать
4. **Гибкость**: можно легко добавить управление номерами через профиль в будущем

## Валидация

Frontend валидирует формат номера при создании направления:

```typescript
if (whatsappPhoneNumber.trim() && !whatsappPhoneNumber.match(/^\+[1-9][0-9]{7,14}$/)) {
  setError('Неверный формат WhatsApp номера. Используйте международный формат: +12345678901');
  return;
}
```

## API Endpoints

### POST /api/directions

**Request body:**
```json
{
  "userAccountId": "uuid",
  "name": "Тестовое направление",
  "objective": "whatsapp",
  "daily_budget_cents": 5000,
  "target_cpl_cents": 200,
  "whatsapp_phone_number": "+77001234567",  // <-- Номер передается напрямую
  "default_settings": {
    "client_question": "Здравствуйте!",
    ...
  }
}
```

**Response:**
```json
{
  "success": true,
  "direction": {
    "id": "uuid",
    "whatsapp_phone_number_id": "uuid",  // <-- ID созданного/найденного номера
    ...
  }
}
```

### GET /api/directions

**Response:**
```json
{
  "success": true,
  "directions": [
    {
      "id": "uuid",
      "name": "Тестовое направление",
      "whatsapp_phone_number": "+77001234567",  // <-- Номер джойнится из whatsapp_phone_numbers
      ...
    }
  ]
}
```

## Миграция

Миграция `012_whatsapp_phone_numbers_table.sql` автоматически:
1. Создает таблицу `whatsapp_phone_numbers`
2. Добавляет колонку `whatsapp_phone_number_id` в `account_directions`
3. Мигрирует существующие номера из `user_accounts` в новую таблицу (как дефолтные)

## Тестирование

```bash
# 1. Создать направление с новым номером
curl -X POST http://localhost:7080/api/directions \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "uuid",
    "name": "Test Direction",
    "objective": "whatsapp",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200,
    "whatsapp_phone_number": "+77001234567"
  }'

# 2. Проверить, что номер сохранен
SELECT * FROM whatsapp_phone_numbers;

# 3. Создать еще одно направление с тем же номером
# (должен переиспользоваться существующий номер)
curl -X POST http://localhost:7080/api/directions \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "uuid",
    "name": "Test Direction 2",
    "objective": "whatsapp",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200,
    "whatsapp_phone_number": "+77001234567"
  }'

# 4. Проверить, что номер не дублировался
SELECT COUNT(*) FROM whatsapp_phone_numbers WHERE phone_number = '+77001234567';
-- Должно быть 1
```





