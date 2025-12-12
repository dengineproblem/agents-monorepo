# AI Chat Assistant

Чат-интерфейс в стиле ChatGPT/Claude для управления рекламой, CRM и WhatsApp через естественный язык.

## Обзор

AI Ассистент позволяет пользователям взаимодействовать с системой через чат:
- Просматривать метрики рекламы и статистику
- Управлять кампаниями (пауза, возобновление, изменение бюджета)
- Работать с лидами и CRM
- Анализировать WhatsApp диалоги
- Генерировать креативы

## Архитектура

### Многоагентная система (v2)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                │
│  /assistant → Assistant.tsx                                     │
│  ├── ChatSidebar (список чатов)                                │
│  ├── ChatMessages (лента сообщений)                            │
│  ├── ChatInput + ModeSelector (ввод + режим)                   │
│  └── PlanApprovalModal (подтверждение плана)                   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    agent-brain (порт 7080)                      │
│  /api/brain/chat                                                │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    ORCHESTRATOR                            │ │
│  │  ├── classifier.js    (классификация запросов)            │ │
│  │  ├── systemPrompt.js  (промпты координации)               │ │
│  │  └── index.js         (маршрутизация + синтез)            │ │
│  └──────────────────────────┬────────────────────────────────┘ │
│                             │                                   │
│         ┌───────────────────┼───────────────────┐              │
│         ▼                   ▼                   ▼              │
│  ┌─────────────┐   ┌─────────────────┐   ┌─────────────┐      │
│  │  AdsAgent   │   │  WhatsAppAgent  │   │  CRMAgent   │      │
│  │  9 tools    │   │  3 tools        │   │  4 tools    │      │
│  │             │   │                 │   │             │      │
│  │ - campaigns │   │ - dialogs       │   │ - leads     │      │
│  │ - budgets   │   │ - messages      │   │ - funnel    │      │
│  │ - metrics   │   │ - analysis      │   │ - stages    │      │
│  └─────────────┘   └─────────────────┘   └─────────────┘      │
│                                                                 │
│  shared/                                                        │
│  ├── fbGraph.js    (Facebook API)                              │
│  └── dateUtils.js  (утилиты дат)                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         Supabase      Facebook API    OpenAI API
```

### Преимущества многоагентной архитектуры

| Аспект | Монолит (v1) | Многоагентная (v2) |
|--------|--------------|-------------------|
| Tools в запросе | 21 всегда | 3-9 (только нужные) |
| Системный промпт | Один большой | Специализированные |
| Стоимость API | Высокая | Ниже (меньше tokens) |
| Качество ответов | Общее | Экспертное по домену |
| Масштабируемость | Сложно | Легко добавить агента |

## Агенты

### AdsAgent (Реклама)
**9 инструментов**: управление Facebook/Instagram рекламой

| Инструмент | Тип | Описание |
|------------|-----|----------|
| `getCampaigns` | READ | Список кампаний с метриками |
| `getCampaignDetails` | READ | Детали кампании + адсеты |
| `getAdSets` | READ | Список адсетов |
| `getSpendReport` | READ | Отчёт по расходам |
| `pauseCampaign` | WRITE | Пауза кампании |
| `resumeCampaign` | WRITE | Возобновление кампании |
| `pauseAdSet` | WRITE | Пауза адсета |
| `resumeAdSet` | WRITE | Возобновление адсета |
| `updateBudget` | WRITE ⚠️ | Изменение бюджета (dangerous) |

### WhatsAppAgent (Диалоги)
**3 инструмента**: анализ WhatsApp переписок

| Инструмент | Тип | Описание |
|------------|-----|----------|
| `getDialogs` | READ | Список диалогов |
| `getDialogMessages` | READ | Сообщения диалога |
| `analyzeDialog` | READ | AI-анализ переписки |

### CRMAgent (Лиды)
**4 инструмента**: работа с лидами и воронкой

| Инструмент | Тип | Описание |
|------------|-----|----------|
| `getLeads` | READ | Список лидов с фильтрами |
| `getLeadDetails` | READ | Детальная информация |
| `getFunnelStats` | READ | Статистика воронки |
| `updateLeadStage` | WRITE | Смена этапа воронки |

## Классификатор запросов

Orchestrator автоматически определяет к какому агенту направить запрос:

### Примеры маршрутизации

| Запрос пользователя | Агент |
|---------------------|-------|
| "Покажи расходы за сегодня" | AdsAgent |
| "Остановить кампанию X" | AdsAgent |
| "Какой CPL у кампаний?" | AdsAgent |
| "Найди горячих лидов" | CRMAgent |
| "Покажи воронку за неделю" | CRMAgent |
| "Покажи диалоги" | WhatsAppAgent |
| "Проанализируй переписку с +79..." | WhatsAppAgent |
| "Лиды из кампании X" | AdsAgent → CRMAgent (mixed) |

### Метод классификации

1. **Быстрая классификация** — по ключевым словам (моментально)
2. **LLM классификация** — для сложных/неоднозначных запросов (gpt-4o-mini)

## Режимы работы

| Режим | Иконка | Поведение |
|-------|--------|-----------|
| **Auto** | ⚡ | Выполняет действия сразу (READ — без подтверждения, WRITE — по ситуации) |
| **Plan** | 📋 | Всегда показывает план перед WRITE операциями, ждёт подтверждения |
| **Ask** | ❓ | Всегда уточняет детали перед любым действием |

### Plan Approval Modal

При построении плана появляется окно с кнопками:
- **No** — отменить
- **Yes** — выполнить план
- **Yes + Auto** — выполнить и автоматически корректировать при ошибках
- **Yes + Manual** — подтверждать каждый шаг отдельно

## База данных

### Таблицы

```sql
-- Чаты/диалоги
ai_conversations (
  id uuid PRIMARY KEY,
  user_account_id uuid REFERENCES user_accounts,
  ad_account_id uuid REFERENCES ad_accounts,
  title text,
  mode text DEFAULT 'auto',  -- 'auto' | 'plan' | 'ask'
  created_at timestamptz,
  updated_at timestamptz
)

-- Сообщения
ai_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid REFERENCES ai_conversations,
  role text,              -- 'user' | 'assistant' | 'system'
  content text,
  plan_json jsonb,        -- план действий
  actions_json jsonb,     -- выполненные действия
  tool_calls_json jsonb,  -- вызовы инструментов
  created_at timestamptz
)
```

### Миграция

```bash
# Применить миграцию
psql $DATABASE_URL < migrations/089_ai_chat_tables.sql
```

## API Endpoints

### POST /api/brain/chat
Отправить сообщение ассистенту.

**Request:**
```json
{
  "message": "Покажи расходы за сегодня",
  "conversationId": "uuid",       // optional, для продолжения диалога
  "mode": "auto",                 // 'auto' | 'plan' | 'ask'
  "userAccountId": "uuid",        // required
  "adAccountId": "uuid"           // optional
}
```

**Response:**
```json
{
  "conversationId": "uuid",
  "response": "Расходы за сегодня: $150...",
  "plan": null,                   // или объект плана
  "data": { ... },               // структурированные данные
  "needsClarification": false,
  "clarificationQuestion": null,
  "executedActions": [...],
  "mode": "auto",
  "agent": "AdsAgent",           // какой агент ответил
  "delegatedTo": "ads",          // куда был направлен запрос
  "classification": {            // результат классификации
    "domain": "ads",
    "agents": ["ads"]
  }
}
```

### GET /api/brain/conversations
Список чатов пользователя.

**Query params:** `userAccountId`, `adAccountId?`, `limit?`

### GET /api/brain/conversations/:id/messages
Сообщения чата.

**Query params:** `userAccountId`

### DELETE /api/brain/conversations/:id
Удалить чат.

**Query params:** `userAccountId`

### POST /api/brain/conversations/:id/execute
Выполнить план или отдельное действие.

**Request:**
```json
{
  "userAccountId": "uuid",
  "adAccountId": "uuid",
  "actionIndex": 0,       // или
  "executeAll": true
}
```

## Файловая структура

```
services/agent-brain/src/chatAssistant/
├── index.js                    — entry point (с оркестратором)
├── contextGatherer.js          — сбор контекста из БД
├── systemPrompt.js             — legacy промпт
├── tools.js                    — legacy tools (для fallback)
├── toolHandlers.js             — legacy handlers (для fallback)
│
├── orchestrator/
│   ├── index.js                — Orchestrator class
│   ├── classifier.js           — классификация запросов
│   └── systemPrompt.js         — промпты оркестратора
│
├── agents/
│   ├── BaseAgent.js            — базовый класс агента
│   ├── index.js                — экспорт всех агентов
│   │
│   ├── ads/
│   │   ├── index.js            — AdsAgent
│   │   ├── tools.js            — 9 инструментов
│   │   ├── handlers.js         — обработчики
│   │   └── prompt.js           — специализированный промпт
│   │
│   ├── whatsapp/
│   │   ├── index.js            — WhatsAppAgent
│   │   ├── tools.js            — 3 инструмента
│   │   ├── handlers.js         — обработчики
│   │   └── prompt.js           — специализированный промпт
│   │
│   └── crm/
│       ├── index.js            — CRMAgent
│       ├── tools.js            — 4 инструмента
│       ├── handlers.js         — обработчики
│       └── prompt.js           — специализированный промпт
│
└── shared/
    ├── index.js                — экспорт утилит
    ├── fbGraph.js              — Facebook API утилита
    └── dateUtils.js            — работа с периодами

services/frontend/src/
├── pages/Assistant.tsx           — главная страница
├── components/assistant/
│   ├── ChatSidebar.tsx          — список чатов
│   ├── ChatMessages.tsx         — лента сообщений
│   ├── ChatInput.tsx            — ввод + режим
│   ├── MessageBubble.tsx        — одно сообщение
│   ├── ModeSelector.tsx         — переключатель режимов
│   ├── PlanApprovalModal.tsx    — окно подтверждения
│   └── index.ts                 — экспорты
├── services/assistantApi.ts     — API клиент
└── config/api.ts                — BRAIN_API_BASE_URL

migrations/
└── 089_ai_chat_tables.sql       — таблицы чата
```

## Конфигурация

### Environment Variables (agent-brain)
```bash
OPENAI_API_KEY=sk-...
CHAT_ASSISTANT_MODEL=gpt-4o           # по умолчанию
CHAT_USE_ORCHESTRATOR=true            # использовать многоагентную систему (default: true)
                                      # false — legacy режим с одним агентом
```

### Frontend (.env)
```bash
VITE_BRAIN_API_BASE_URL=http://localhost:7080  # для локальной разработки
```

## Запуск

1. **Применить миграцию:**
   ```bash
   # В Supabase SQL Editor или через psql
   psql $DATABASE_URL < migrations/089_ai_chat_tables.sql
   ```

2. **Перезапустить agent-brain:**
   ```bash
   cd services/agent-brain
   npm run dev  # или docker-compose restart agent-brain
   ```

3. **Открыть в браузере:**
   ```
   http://localhost:3001/assistant
   ```

## Примеры использования

### Просмотр данных
```
Пользователь: Покажи расходы за вчера
Ассистент: [AdsAgent → getSpendReport] Вчера было потрачено $127...
```

### Управление кампаниями (режим Plan)
```
Пользователь: Остановить неэффективные кампании
Ассистент: [AdsAgent] Нашёл 2 кампании с CPL > $50:
  1. "Имплантация Москва" — CPL $67
  2. "Виниры СПб" — CPL $52

  [План действий]
  1. Пауза кампании "Имплантация Москва"
  2. Пауза кампании "Виниры СПб"

  Ожидаемая экономия: ~$120/день

  [No] [Yes] [Yes+Auto] [Yes+Manual]
```

### Работа с лидами
```
Пользователь: Найди горячих лидов
Ассистент: [CRMAgent → getLeads с interest_level=hot]
  🔥 Горячие лиды (5):
  1. Иван Петров — score 85, этап "Консультация"
  2. ...
```

### Анализ диалогов
```
Пользователь: Проанализируй диалог с +7999123456
Ассистент: [WhatsAppAgent → analyzeDialog]
  📱 Анализ диалога:

  **Температура:** 🔥 Hot (score: 78)
  **Интересы:** имплантация, цена
  **Возражения:** высокая стоимость
  **Рекомендация:** предложить рассрочку
```

### Мультиагентный запрос
```
Пользователь: Покажи лидов из кампании "Имплантация Москва"
Ассистент: [Orchestrator координирует AdsAgent + CRMAgent]

  Кампания "Имплантация Москва":
  - Расход: $250
  - Лидов: 5

  Лиды из этой кампании:
  1. 🔥 Анна Иванова — score 82
  2. ⚡ Пётр Сидоров — score 54
  ...
```

## Troubleshooting

### "No Facebook access token found"
Убедитесь что у пользователя подключён Facebook аккаунт в профиле.

### "Failed to get conversations"
Проверьте что миграция применена и таблицы `ai_conversations`, `ai_messages` существуют.

### Ошибки OpenAI
Проверьте `OPENAI_API_KEY` в env и лимиты API.

### Запросы направляются не тому агенту
1. Проверьте логи классификатора
2. Добавьте ключевые слова в `orchestrator/classifier.js`
3. Используйте более явные формулировки в запросе

### Отключить многоагентную систему
```bash
CHAT_USE_ORCHESTRATOR=false
```
Это вернёт legacy режим с одним агентом и всеми 21 инструментами.

## Добавление нового агента

1. Создать папку `agents/newagent/`
2. Создать файлы: `index.js`, `tools.js`, `handlers.js`, `prompt.js`
3. Добавить агента в `orchestrator/index.js`
4. Добавить ключевые слова в `orchestrator/classifier.js`
