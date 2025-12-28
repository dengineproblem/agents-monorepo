# План интеграции AI-бота с консультациями

## Обзор

Интеграция позволит AI-боту в WhatsApp:
- Показывать свободные слоты для консультаций
- Записывать клиентов на консультации
- Отменять и переносить записи
- Автоматически заполнять карточку консультации (саммаризация диалога)

---

## Этап 1: База данных

### 1.1 Расширение таблицы `ai_bot_configurations`

```sql
ALTER TABLE ai_bot_configurations ADD COLUMN IF NOT EXISTS
  consultation_integration_enabled BOOLEAN DEFAULT false;

ALTER TABLE ai_bot_configurations ADD COLUMN IF NOT EXISTS
  consultation_settings JSONB DEFAULT '{}'::jsonb;
```

**Структура `consultation_settings`:**
```json
{
  "consultant_ids": ["uuid1", "uuid2"],  // пустой = все консультанты
  "slots_to_show": 5,                     // кол-во слотов для показа
  "default_duration_minutes": 60,         // длительность консультации
  "days_ahead_limit": 14,                 // максимум дней вперёд
  "auto_summarize_dialog": true,          // саммаризация в примечание
  "collect_client_name": true             // спрашивать имя если нет
}
```

### 1.2 Миграция

Файл: `migrations/XXX_add_consultation_integration.sql`

---

## Этап 2: Backend API (crm-backend)

### 2.1 Новые эндпоинты для бота

**GET /api/consultations/available-slots**
```typescript
Query params:
  - consultant_ids?: string[]  // фильтр по консультантам
  - date?: string              // конкретная дата (YYYY-MM-DD)
  - days_ahead?: number        // дней вперёд (по умолчанию 7)
  - limit?: number             // кол-во слотов (по умолчанию 5)
  - duration_minutes: number   // длительность консультации

Response:
{
  slots: [
    {
      consultant_id: "uuid",
      consultant_name: "Иван Петров",
      date: "2025-12-30",
      start_time: "14:00",
      end_time: "15:00",
      formatted: "30 декабря в 14:00 (Иван Петров)"
    }
  ]
}
```

**POST /api/consultations/book-from-bot**
```typescript
Body:
{
  dialog_analysis_id: "uuid",      // лид
  consultant_id: "uuid",
  date: "2025-12-30",
  start_time: "14:00",
  duration_minutes: 60,
  client_name: "Имя клиента",
  notes: "Саммаризация диалога..."
}

Response:
{
  success: true,
  consultation: { ... },
  confirmation_message: "Вы записаны на консультацию 30 декабря в 14:00 к Ивану Петрову"
}
```

**POST /api/consultations/cancel-from-bot**
```typescript
Body:
{
  dialog_analysis_id: "uuid",
  consultation_id?: "uuid"  // если не указан - последняя активная
}
```

**POST /api/consultations/reschedule-from-bot**
```typescript
Body:
{
  dialog_analysis_id: "uuid",
  consultation_id?: "uuid",
  new_date: "2025-12-31",
  new_start_time: "10:00"
}
```

### 2.2 Вспомогательные функции

**Файл: `src/lib/consultationSlots.ts`**

```typescript
// Генерация доступных слотов на основе расписания
function generateAvailableSlotsFromSchedule(
  consultantId: string,
  date: Date,
  durationMinutes: number
): Slot[]

// Проверка занятости слота
function isSlotAvailable(
  consultantId: string,
  date: string,
  startTime: string,
  durationMinutes: number
): boolean

// Форматирование слота для клиента
function formatSlotForClient(slot: Slot): string
// "Завтра в 14:00" / "30 декабря в 14:00"
```

**Файл: `src/lib/dialogSummarizer.ts`**

```typescript
// Саммаризация диалога через AI
async function summarizeDialog(
  dialogAnalysisId: string,
  maxLength: number = 500
): Promise<string>
```

---

## Этап 3: Chatbot Service - Internal Functions

### 3.1 Новые встроенные функции

**Файл: `src/lib/consultationTools.ts`**

#### Функция 1: `get_available_consultation_slots`

```typescript
{
  name: "get_available_consultation_slots",
  description: "Получить список свободных слотов для записи на консультацию",
  parameters: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description: "Конкретная дата в формате YYYY-MM-DD (опционально)"
      },
      days_ahead: {
        type: "number",
        description: "Сколько дней вперёд искать слоты (по умолчанию из настроек)"
      }
    }
  }
}
```

**Логика:**
1. Получить настройки интеграции из конфига бота
2. Запросить слоты через API `/available-slots`
3. Вернуть форматированный список для AI

#### Функция 2: `book_consultation`

```typescript
{
  name: "book_consultation",
  description: "Записать клиента на консультацию",
  parameters: {
    type: "object",
    properties: {
      consultant_id: { type: "string" },
      date: { type: "string", description: "YYYY-MM-DD" },
      start_time: { type: "string", description: "HH:MM" },
      client_name: { type: "string" }
    },
    required: ["consultant_id", "date", "start_time"]
  }
}
```

**Логика:**
1. Получить имя клиента (из параметра или WhatsApp профиля)
2. Саммаризировать диалог для примечания
3. Создать консультацию через API
4. Вернуть подтверждение

#### Функция 3: `cancel_consultation`

```typescript
{
  name: "cancel_consultation",
  description: "Отменить запись на консультацию",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Причина отмены" }
    }
  }
}
```

#### Функция 4: `reschedule_consultation`

```typescript
{
  name: "reschedule_consultation",
  description: "Перенести консультацию на другое время",
  parameters: {
    type: "object",
    properties: {
      new_date: { type: "string" },
      new_start_time: { type: "string" }
    },
    required: ["new_date", "new_start_time"]
  }
}
```

#### Функция 5: `get_my_consultations`

```typescript
{
  name: "get_my_consultations",
  description: "Показать записи клиента на консультации",
  parameters: {}
}
```

### 3.2 Интеграция в aiBotEngine.ts

**Изменения в `generateAIResponse`:**

```typescript
// Добавить встроенные функции консультаций если интеграция включена
if (botConfig.consultation_integration_enabled) {
  const consultationTools = getConsultationTools(botConfig.consultation_settings);
  tools = [...tools, ...consultationTools];
}
```

**Изменения в `handleFunctionCall`:**

```typescript
// Добавить обработку internal функций консультаций
case 'get_available_consultation_slots':
  return await handleGetAvailableSlots(args, lead, botConfig);
case 'book_consultation':
  return await handleBookConsultation(args, lead, botConfig);
case 'cancel_consultation':
  return await handleCancelConsultation(args, lead, botConfig);
case 'reschedule_consultation':
  return await handleRescheduleConsultation(args, lead, botConfig);
case 'get_my_consultations':
  return await handleGetMyConsultations(lead, botConfig);
```

---

## Этап 4: Frontend (crm-frontend)

### 4.1 Расширение типов

**Файл: `types/aiBot.ts`**

```typescript
interface ConsultationIntegrationSettings {
  consultant_ids: string[];           // пустой = все
  slots_to_show: number;              // 3-10
  default_duration_minutes: number;   // 30, 60, 90, 120
  days_ahead_limit: number;           // 7, 14, 30
  auto_summarize_dialog: boolean;
  collect_client_name: boolean;
}

interface AIBotConfiguration {
  // ... существующие поля
  consultation_integration_enabled: boolean;
  consultation_settings: ConsultationIntegrationSettings;
}
```

### 4.2 UI компонент настроек

**Файл: `components/bot-editor/ConsultationIntegrationTab.tsx`**

```tsx
// Вкладка "Консультации" в редакторе бота

- Switch: Включить интеграцию с консультациями
- MultiSelect: Выбор консультантов (все / конкретные)
- Select: Длительность консультации (30/60/90/120 мин)
- NumberInput: Количество слотов для показа (3-10)
- NumberInput: Дней вперёд (7/14/30)
- Switch: Автоматическая саммаризация диалога
- Switch: Запрашивать имя если не указано в WhatsApp
```

### 4.3 Интеграция в BotEditor.tsx

```tsx
// Добавить новую вкладку
<TabsContent value="consultations">
  <ConsultationIntegrationTab
    config={botConfig}
    consultants={consultants}
    onChange={handleConsultationSettingsChange}
  />
</TabsContent>
```

---

## Этап 5: Промпт для AI

### 5.1 Автоматическое дополнение system_prompt

Когда интеграция включена, добавлять в system_prompt:

```
## Запись на консультацию

У тебя есть возможность записывать клиентов на консультацию.

Доступные функции:
- get_available_consultation_slots - показать свободные слоты
- book_consultation - записать на консультацию
- cancel_consultation - отменить запись
- reschedule_consultation - перенести запись
- get_my_consultations - показать текущие записи клиента

Правила:
1. Если клиент хочет записаться, сначала покажи доступные слоты
2. После выбора слота, уточни имя клиента (если не известно)
3. Подтверди запись и сообщи детали
4. Если клиент хочет отменить/перенести - используй соответствующие функции

Длительность консультации: {duration} минут
Консультанты: {consultant_names}
```

---

## Порядок реализации

### Фаза 1: Backend (2-3 дня)
1. [ ] Миграция БД
2. [ ] API endpoints в crm-backend
3. [ ] Генерация слотов из расписания
4. [ ] Саммаризация диалога

### Фаза 2: Chatbot Service (2-3 дня)
1. [ ] Consultation tools (5 функций)
2. [ ] Интеграция в aiBotEngine
3. [ ] Обработка function calls
4. [ ] Автодополнение промпта

### Фаза 3: Frontend (1-2 дня)
1. [ ] Типы TypeScript
2. [ ] ConsultationIntegrationTab компонент
3. [ ] Интеграция в BotEditor
4. [ ] API сервис

### Фаза 4: Тестирование (1 день)
1. [ ] E2E тест записи через бота
2. [ ] Тест отмены/переноса
3. [ ] Тест с разными настройками

---

## Файлы для создания/изменения

### Новые файлы:
- `migrations/XXX_add_consultation_integration.sql`
- `services/crm-backend/src/lib/consultationSlots.ts`
- `services/crm-backend/src/lib/dialogSummarizer.ts`
- `services/chatbot-service/src/lib/consultationTools.ts`
- `services/crm-frontend/src/components/bot-editor/ConsultationIntegrationTab.tsx`

### Изменения:
- `services/crm-backend/src/routes/consultations.ts` - новые endpoints
- `services/chatbot-service/src/lib/aiBotEngine.ts` - интеграция tools
- `services/crm-frontend/src/pages/BotEditor.tsx` - новая вкладка
- `services/crm-frontend/src/types/aiBot.ts` - новые типы
- `services/crm-frontend/src/services/aiBotApi.ts` - API методы
