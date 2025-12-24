# WhatsApp AI Bot Constructor

## Обзор

WhatsApp AI Bot Constructor — система для создания и настройки AI-ботов, которые автоматически отвечают на сообщения в WhatsApp. Система состоит из:

- **CRM Backend** (`services/crm-backend`) — API для управления ботами (порт 8084)
- **Chatbot Service** (`services/chatbot-service`) — обработка сообщений (порт 8083)
- **CRM Frontend** (`services/crm-frontend`) — UI конструктор

## Архитектура

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Evolution     │────▶│ Chatbot Service │────▶│     OpenAI      │
│   API (WA)      │◀────│   (port 8083)   │◀────│      API        │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   CRM Frontend  │────▶│   CRM Backend   │────▶│    Supabase     │
│   (port 3002)   │◀────│   (port 8084)   │◀────│   PostgreSQL    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │      Redis      │
                                                │  (msg buffer)   │
                                                └─────────────────┘
```

## База данных

### Таблица `ai_bot_configurations`

Основная таблица настроек бота:

```sql
CREATE TABLE ai_bot_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id),
  name TEXT NOT NULL DEFAULT 'Мой бот',
  is_active BOOLEAN DEFAULT true,

  -- AI настройки
  system_prompt TEXT DEFAULT '',
  temperature NUMERIC(3,2) DEFAULT 0.24,
  model TEXT DEFAULT 'gpt-4o',

  -- История сообщений
  history_token_limit INTEGER DEFAULT 8000,
  history_message_limit INTEGER,          -- NULL = без лимита
  history_time_limit_hours INTEGER,       -- NULL = без лимита

  -- Буфер сообщений (ожидание перед ответом)
  message_buffer_seconds INTEGER DEFAULT 7,

  -- Контроль оператора
  operator_pause_enabled BOOLEAN DEFAULT true,
  operator_pause_ignore_first_message BOOLEAN DEFAULT true,
  operator_auto_resume_hours INTEGER DEFAULT 0,
  operator_auto_resume_minutes INTEGER DEFAULT 0,
  operator_pause_exceptions TEXT[] DEFAULT '{}',

  -- Ключевые фразы
  stop_phrases TEXT[] DEFAULT '{}',       -- Фразы для остановки бота
  resume_phrases TEXT[] DEFAULT '{}',     -- Фразы для возобновления

  -- Разбиение сообщений
  split_messages BOOLEAN DEFAULT false,
  split_max_length INTEGER DEFAULT 500,
  clean_markdown BOOLEAN DEFAULT true,

  -- Расписание
  schedule_enabled BOOLEAN DEFAULT false,
  schedule_hours_start INTEGER DEFAULT 9,
  schedule_hours_end INTEGER DEFAULT 18,
  schedule_days INTEGER[] DEFAULT '{1,2,3,4,5}', -- 1=Пн, 7=Вс
  timezone TEXT DEFAULT 'Europe/Moscow',
  pass_current_datetime BOOLEAN DEFAULT true,

  -- Голосовые сообщения
  voice_recognition_enabled BOOLEAN DEFAULT false,
  voice_default_response TEXT,

  -- Изображения
  image_recognition_enabled BOOLEAN DEFAULT false,
  image_default_response TEXT,

  -- Документы
  document_recognition_enabled BOOLEAN DEFAULT false,
  document_default_response TEXT,

  -- Файлы
  file_handling_mode TEXT DEFAULT 'ignore', -- 'ignore' | 'respond'
  file_default_response TEXT,

  -- Сообщения
  start_message TEXT,                     -- Приветственное сообщение
  error_message TEXT,                     -- Сообщение при ошибке

  -- Свой API ключ OpenAI
  custom_openai_api_key TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Таблица `ai_bot_functions`

Функции, которые может вызывать бот:

```sql
CREATE TABLE ai_bot_functions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES ai_bot_configurations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                     -- Имя функции для OpenAI
  description TEXT,                       -- Описание для модели
  parameters JSONB DEFAULT '{}',          -- JSON Schema параметров
  handler_type TEXT NOT NULL,             -- 'forward_to_manager' | 'internal' | 'webhook'
  handler_config JSONB DEFAULT '{}',      -- { url: '...' } для webhook
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Связь с WhatsApp

Таблица `whatsapp_instances` имеет поле `ai_bot_id`:

```sql
ALTER TABLE whatsapp_instances
ADD COLUMN ai_bot_id UUID REFERENCES ai_bot_configurations(id);
```

---

## API Endpoints

### CRM Backend (`/api/crm/...`)

#### Боты

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/ai-bots?userId=...` | Список ботов пользователя |
| GET | `/ai-bots/:botId` | Получить бота с функциями |
| POST | `/ai-bots` | Создать нового бота |
| PUT | `/ai-bots/:botId` | Обновить настройки бота |
| DELETE | `/ai-bots/:botId` | Удалить бота |

#### Функции бота

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/ai-bots/:botId/functions` | Список функций бота |
| POST | `/ai-bots/:botId/functions` | Добавить функцию |
| PUT | `/ai-bot-functions/:funcId` | Обновить функцию |
| DELETE | `/ai-bot-functions/:funcId` | Удалить функцию |

#### WhatsApp связь

| Метод | Endpoint | Описание |
|-------|----------|----------|
| PATCH | `/whatsapp-instances/:instanceId/link-bot` | Привязать бота к инстансу |

### Примеры запросов

**Создание бота:**
```json
POST /api/crm/ai-bots
{
  "userAccountId": "uuid-...",
  "name": "Sales Bot",
  "systemPrompt": "Ты - помощник по продажам...",
  "temperature": 0.3,
  "model": "gpt-4o"
}
```

**Обновление настроек:**
```json
PUT /api/crm/ai-bots/:botId
{
  "name": "Updated Bot",
  "isActive": true,
  "messageBufferSeconds": 10,
  "stopPhrases": ["стоп", "хватит"],
  "resumePhrases": ["продолжи", "давай"],
  "scheduleEnabled": true,
  "scheduleHoursStart": 9,
  "scheduleHoursEnd": 21,
  "scheduleDays": [1, 2, 3, 4, 5]
}
```

**Привязка бота к WhatsApp:**
```json
PATCH /api/crm/whatsapp-instances/:instanceId/link-bot
{
  "botId": "uuid-..." // или null для отвязки
}
```

---

## Обработка сообщений

### Основные файлы

- `services/chatbot-service/src/lib/aiBotEngine.ts` — движок бота
- `services/chatbot-service/src/lib/logUtils.ts` — утилиты логирования

### Поток обработки

```
1. Входящее сообщение (Evolution API webhook)
        │
        ▼
2. processIncomingMessage() — точка входа
        │
        ├── Создание correlation ID для трассировки
        ├── Получение конфига бота (getBotConfigForInstance)
        ├── Проверка лида в dialog_analysis
        └── Проверка условий ответа (shouldBotRespondWithConfig)
        │
        ▼
3. collectMessagesWithConfig() — буферизация
        │
        ├── Добавление сообщения в Redis list
        ├── Сохранение context в Redis
        └── Установка таймера (message_buffer_seconds)
        │
        ▼
4. processAIBotResponse() — генерация ответа
        │
        ├── Загрузка истории (loadMessageHistory)
        ├── Проверка stop/resume фраз
        ├── Генерация ответа (generateAIResponse)
        ├── Очистка markdown (если включено)
        ├── Разбиение на части (если включено)
        └── Отправка через Evolution API
        │
        ▼
5. handleFunctionCall() — выполнение функций (если есть)
        │
        ├── forward_to_manager → assigned_to_human = true
        ├── internal → save_user_data и т.д.
        └── webhook → HTTP POST на внешний URL
```

### Условия ответа бота

Бот НЕ отвечает если:

1. **bot_paused = true** — бот на паузе (кроме resume фраз)
2. **assigned_to_human = true** — передан человеку
3. **Вне расписания** — текущее время не в schedule_hours
4. **Сообщение от оператора** — operator_pause_enabled
5. **Обнаружена stop_phrase** — бот ставится на паузу

Бот ВОЗОБНОВЛЯЕТ работу если:

- Обнаружена resume_phrase
- Истек operator_auto_resume_hours/minutes
- bot_paused_until < now()

---

## Система логирования

### Ключевые концепции

#### 1. Correlation ID

Уникальный идентификатор для трассировки всего флоу обработки:

```typescript
// Формат: req_a1b2c3d4e5f6...
const correlationId = generateCorrelationId();
// В логах показывается короткая версия: a1b2c3d4
```

#### 2. Структурированные теги

Категории для фильтрации логов:

| Тег | Описание |
|-----|----------|
| `db` | Операции с базой данных |
| `api` | HTTP запросы/ответы |
| `openai` | Вызовы OpenAI API |
| `webhook` | Исходящие вебхуки |
| `redis` | Операции Redis |
| `processing` | Бизнес-логика |
| `message` | Обработка сообщений |
| `schedule` | Расписание/таймеры |
| `config` | Конфигурация бота |
| `validation` | Валидация данных |

#### 3. Маскирование данных

Автоматическое скрытие чувствительных данных:

```typescript
maskPhone('+79991234567')  // → '+7***4567'
maskUuid('550e8400-e29b-41d4-a716-446655440000')  // → '550e...0000'
maskApiKey('sk-1234567890abcdef')  // → 'sk-123...cdef'
maskEmail('user@example.com')  // → 'u***@example.com'
```

#### 4. Метрики производительности

Автоматический тайминг между этапами:

```typescript
ctxLog.checkpoint('fetch_config');
// ... операция ...
ctxLog.checkpoint('generate_ai');
// ... операция ...

ctxLog.getTimings();
// {
//   totalElapsedMs: 1234,
//   fetch_configMs: 45,
//   generate_aiMs: 890
// }
```

#### 5. Классификация ошибок

```typescript
classifyError(error);
// {
//   type: 'db_error' | 'api_error' | 'openai_error' | 'timeout_error' | ...,
//   isRetryable: boolean
// }
```

### Пример лога

```json
{
  "level": "info",
  "time": "2024-12-24T10:30:00.000Z",
  "cid": "a1b2c3d4",
  "phone": "+7***4567",
  "instance": "my-whatsapp",
  "botId": "550e...0000",
  "botName": "Sales Bot",
  "tags": ["message", "processing"],
  "elapsedMs": 45,
  "msgType": "text",
  "msgLength": 128,
  "msg": "[processIncomingMessage] === NEW INCOMING MESSAGE ==="
}
```

### Context Propagation

Контекст сохраняется через Redis для асинхронных операций:

```typescript
// При буферизации сообщения
await redis.set(`ctx:${key}`, JSON.stringify(ctx), 'EX', bufferSeconds + 5);

// При срабатывании таймера
const savedCtx = JSON.parse(await redis.get(`ctx:${key}`));
const timerLog = createContextLogger(baseLog, savedCtx, ['redis']);
```

---

## Конфигурация моделей

Поддерживаемые модели OpenAI:

| Модель | Описание |
|--------|----------|
| gpt-4o | Основная мультимодальная модель |
| gpt-4o-mini | Быстрая и дешевая |
| gpt-4.1 | Улучшенная GPT-4 |
| gpt-4.1-mini | Облегченная версия |
| gpt-4.1-nano | Самая легкая |
| gpt-5 | Новейшая модель |
| gpt-5-mini | Облегченная GPT-5 |
| gpt-5-nano | Минимальная GPT-5 |
| gpt-o3 | Reasoning модель |

---

## Типы функций бота

### 1. forward_to_manager

Передает диалог менеджеру:

```json
{
  "name": "transfer_to_human",
  "description": "Передать диалог менеджеру когда клиент просит",
  "handlerType": "forward_to_manager",
  "handlerConfig": {}
}
```

### 2. internal

Внутренние функции (save_user_data):

```json
{
  "name": "save_user_data",
  "description": "Сохранить данные клиента",
  "parameters": {
    "type": "object",
    "properties": {
      "contact_name": { "type": "string" },
      "business_type": { "type": "string" }
    }
  },
  "handlerType": "internal",
  "handlerConfig": {}
}
```

### 3. webhook

Вызов внешнего API:

```json
{
  "name": "create_order",
  "description": "Создать заказ в CRM",
  "parameters": {
    "type": "object",
    "properties": {
      "product_id": { "type": "string" },
      "quantity": { "type": "number" }
    }
  },
  "handlerType": "webhook",
  "handlerConfig": {
    "url": "https://api.example.com/orders"
  }
}
```

---

## Примеры использования

### Создание бота для продаж

```javascript
// 1. Создать бота
const { bot } = await fetch('/api/crm/ai-bots', {
  method: 'POST',
  body: JSON.stringify({
    userAccountId: userId,
    name: 'Sales Bot',
    systemPrompt: `Ты - менеджер по продажам компании X.
Твоя задача: узнать потребности клиента, предложить подходящий продукт.
Будь вежлив, но не навязчив.
Если клиент готов к покупке - вызови функцию transfer_to_human.`,
    temperature: 0.5,
    model: 'gpt-4o'
  })
});

// 2. Настроить бота
await fetch(`/api/crm/ai-bots/${bot.id}`, {
  method: 'PUT',
  body: JSON.stringify({
    messageBufferSeconds: 5,
    stopPhrases: ['стоп', 'не интересует', 'отписаться'],
    resumePhrases: ['продолжить', 'расскажи подробнее'],
    scheduleEnabled: true,
    scheduleHoursStart: 9,
    scheduleHoursEnd: 21,
    scheduleDays: [1, 2, 3, 4, 5, 6],
    operatorPauseEnabled: true,
    operatorAutoResumeHours: 2
  })
});

// 3. Добавить функцию передачи менеджеру
await fetch(`/api/crm/ai-bots/${bot.id}/functions`, {
  method: 'POST',
  body: JSON.stringify({
    name: 'transfer_to_human',
    description: 'Передать диалог менеджеру для завершения продажи',
    handlerType: 'forward_to_manager'
  })
});

// 4. Привязать к WhatsApp
await fetch(`/api/crm/whatsapp-instances/${instanceId}/link-bot`, {
  method: 'PATCH',
  body: JSON.stringify({ botId: bot.id })
});
```

---

## Troubleshooting

### Бот не отвечает

1. Проверить `is_active = true` в конфигурации бота
2. Проверить привязку бота к инстансу (`ai_bot_id` в `whatsapp_instances`)
3. Проверить что лид существует в `dialog_analysis`
4. Проверить расписание (schedule_enabled, schedule_hours)
5. Проверить что бот не на паузе (`bot_paused` в `dialog_analysis`)

### Смотреть логи

```bash
# chatbot-service
docker logs chatbot-service -f | grep "processIncomingMessage"

# Фильтр по correlation ID
docker logs chatbot-service -f | grep "cid.*a1b2c3d4"

# Только ошибки
docker logs chatbot-service -f | grep "level.*error"

# Только OpenAI вызовы
docker logs chatbot-service -f | grep "tags.*openai"
```

### Проверить Redis буфер

```bash
redis-cli keys "pending_messages:*"
redis-cli lrange "pending_messages:instance:phone" 0 -1
```

---

## Зависимости

### chatbot-service
- `fastify` — веб-фреймворк
- `openai` — OpenAI SDK
- `ioredis` — Redis клиент
- `@supabase/supabase-js` — Supabase клиент
- `pino` — логгер

### crm-backend
- `fastify` — веб-фреймворк
- `zod` — валидация
- `@supabase/supabase-js` — Supabase клиент
- `pino` — логгер

---

## История изменений

### v1.0.0 (2024-12-24)
- Базовая структура AI Bot Constructor
- CRUD API для ботов и функций
- Интеграция с chatbot-service
- Привязка ботов к WhatsApp инстансам

### v1.1.0 (2024-12-24)
- Исправление критических багов (messages table, stop/resume phrases)
- Добавление базового логирования

### v1.2.0 (2024-12-24)
- Расширенное логирование:
  - Correlation ID для трассировки
  - Структурированные теги
  - Маскирование чувствительных данных
  - Метрики производительности
  - Классификация ошибок
  - Context propagation через Redis
