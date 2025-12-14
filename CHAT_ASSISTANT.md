# Chat Assistant Architecture

AI-ассистент для управления Facebook рекламой через Telegram бота.

## Архитектура

```
User Request
     │
     ▼
┌─────────────────┐
│   Classifier    │  ← Определяет домен запроса (keywords + LLM fallback)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Orchestrator   │  ← Маршрутизирует к агентам, синтезирует ответы
└────────┬────────┘
         │
    ┌────┴────┬──────────┬──────────┐
    ▼         ▼          ▼          ▼
┌───────┐ ┌────────┐ ┌─────────┐ ┌──────┐
│  Ads  │ │Creative│ │WhatsApp │ │ CRM  │
│ Agent │ │ Agent  │ │  Agent  │ │Agent │
└───────┘ └────────┘ └─────────┘ └──────┘
```

## Агенты

### AdsAgent — Реклама и Направления
**Путь:** `services/agent-brain/src/chatAssistant/agents/ads/`

**17 инструментов:**

| Tool | Тип | Описание |
|------|-----|----------|
| `getCampaigns` | READ | Список кампаний с метриками |
| `getCampaignDetails` | READ | Детали кампании + адсеты + объявления |
| `getAdSets` | READ | Адсеты кампании с метриками |
| `getSpendReport` | READ | Отчёт по расходам (группировка по дням/кампаниям) |
| `getDirections` | READ | Направления с агрегированными метриками |
| `getDirectionDetails` | READ | Детали направления + креативы + FB адсет |
| `getDirectionMetrics` | READ | Метрики направления по дням |
| `getROIReport` | READ | Отчёт по ROI креативов (расходы, выручка, ROI%, лиды, конверсии) |
| `getROIComparison` | READ | Сравнение ROI между креативами или направлениями |
| `pauseCampaign` | WRITE | Пауза кампании |
| `resumeCampaign` | WRITE | Возобновление кампании |
| `pauseAdSet` | WRITE | Пауза адсета |
| `resumeAdSet` | WRITE | Возобновление адсета |
| `updateBudget` | WRITE | Изменение бюджета адсета |
| `updateDirectionBudget` | WRITE | Изменение бюджета направления |
| `updateDirectionTargetCPL` | WRITE | Изменение целевого CPL |
| `pauseDirection` | WRITE | Пауза направления + FB адсет |

**Файлы:**
- `index.js` — класс AdsAgent
- `tools.js` — определения инструментов
- `handlers.js` — реализация обработчиков
- `prompt.js` — системный промпт

---

### CreativeAgent — Креативы
**Путь:** `services/agent-brain/src/chatAssistant/agents/creative/`

**15 инструментов:**

| Tool | Тип | Описание |
|------|-----|----------|
| `getCreatives` | READ | Список креативов с метриками и скорами |
| `getCreativeDetails` | READ | Детали креатива + привязки к ads/directions |
| `getCreativeMetrics` | READ | Метрики + video retention (daily breakdown) |
| `getCreativeAnalysis` | READ | LLM-анализ (score, verdict, recommendations) |
| `getTopCreatives` | READ | Топ-N лучших по метрике |
| `getWorstCreatives` | READ | Худшие креативы (высокий CPL) |
| `compareCreatives` | READ | Сравнение 2-5 креативов |
| `getCreativeScores` | READ | Risk scores от scoring agent |
| `getCreativeTests` | READ | История A/B тестов |
| `getCreativeTranscript` | READ | Транскрипция видео |
| `triggerCreativeAnalysis` | WRITE | Запуск LLM-анализа |
| `launchCreative` | WRITE | Запуск креатива в направление |
| `pauseCreative` | WRITE | Пауза всех объявлений креатива |
| `startCreativeTest` | WRITE | Запуск A/B теста (~$20) |
| `stopCreativeTest` | WRITE | Остановка теста |

**Файлы:**
- `index.js` — класс CreativeAgent
- `tools.js` — определения инструментов
- `handlers.js` — реализация обработчиков
- `prompt.js` — системный промпт

---

### WhatsAppAgent — Диалоги
**Путь:** `services/agent-brain/src/chatAssistant/agents/whatsapp/`

Работа с WhatsApp диалогами и сообщениями.

---

### CRMAgent — Лиды
**Путь:** `services/agent-brain/src/chatAssistant/agents/crm/`

**5 инструментов:**

| Tool | Тип | Описание |
|------|-----|----------|
| `getLeads` | READ | Список лидов с фильтрами (температура, этап, score) |
| `getLeadDetails` | READ | Детали лида (контакты, анализ диалога) |
| `getFunnelStats` | READ | Статистика воронки продаж |
| `getRevenueStats` | READ | Статистика выручки (сумма, ср. чек, конверсия, топ покупателей) |
| `updateLeadStage` | WRITE | Изменение этапа воронки |

---

## Orchestrator

**Путь:** `services/agent-brain/src/chatAssistant/orchestrator/`

### Classifier (`classifier.js`)
Определяет домен запроса:
1. **Quick classification** — поиск ключевых слов
2. **LLM fallback** — GPT-4o-mini для сложных запросов

**Домены:**
- `ads` — кампании, адсеты, направления, бюджеты
- `creative` — креативы, видео, retention, тесты
- `whatsapp` — диалоги, сообщения
- `crm` — лиды, воронка, квалификация
- `mixed` — запрос требует нескольких агентов

### Orchestrator (`index.js`)
- Маршрутизация к агентам
- Параллельное выполнение при `mixed`
- Синтез ответов от нескольких агентов

---

## Режимы работы

| Режим | Описание |
|-------|----------|
| `auto` | READ автоматически, WRITE с объяснением |
| `plan` | Анализ + план, WRITE требует подтверждения |
| `ask` | Всё требует подтверждения |

---

## Примеры маршрутизации

| Запрос | Агент | Tool |
|--------|-------|------|
| "Покажи расходы за сегодня" | AdsAgent | getSpendReport |
| "Какие направления активны?" | AdsAgent | getDirections |
| "Измени бюджет направления" | AdsAgent | updateDirectionBudget |
| "Какой ROI за последнюю неделю?" | AdsAgent | getROIReport |
| "Сравни окупаемость направлений" | AdsAgent | getROIComparison |
| "Покажи все креативы" | CreativeAgent | getCreatives |
| "Топ креативы по CPL" | CreativeAgent | getTopCreatives |
| "Проанализируй креатив" | CreativeAgent | triggerCreativeAnalysis |
| "Запусти креатив в направление" | CreativeAgent | launchCreative |
| "Сравни эти 3 креатива" | CreativeAgent | compareCreatives |
| "Покажи retention видео" | CreativeAgent | getCreativeMetrics |
| "Последние диалоги" | WhatsAppAgent | getDialogs |
| "Лиды за сегодня" | CRMAgent | getLeads |
| "Какая выручка за месяц?" | CRMAgent | getRevenueStats |

---

## Ключевые метрики

### Реклама
- **Spend** — потраченный бюджет ($)
- **Leads** — количество заявок (сумма всех источников):
  - `onsite_conversion.total_messaging_connection` — WhatsApp/Instagram мессенджер лиды
  - `offsite_conversion.fb_pixel_lead` — лиды с сайта через FB пиксель
  - `offsite_conversion.custom*` — кастомные конверсии пикселя
- **CPL** — Cost Per Lead (стоимость заявки)
- **CPM** — Cost Per Mille (стоимость 1000 показов)
- **CTR** — Click Through Rate (кликабельность)

### Креативы
- **Video Views** — просмотры видео
- **Retention 25/50/75/95%** — % досмотревших до точки
- **Risk Score** (0-100) — оценка риска роста CPL
- **LLM Score** (0-100) — общая оценка креатива

---

## Таблицы БД

### Ads
- `campaigns` — кампании FB
- `adsets` — адсеты FB
- `ads` — объявления FB
- `account_directions` — направления (рекламные вертикали)
  - `is_active` (boolean) — активно ли направление
  - `campaign_status` — статус FB кампании (ACTIVE/PAUSED)
  - `daily_budget_cents` — бюджет в центах
  - `target_cpl_cents` — целевой CPL в центах
  - `fb_campaign_id` — ID кампании в Facebook

### Creatives
- `user_creatives` — креативы пользователя
- `creative_analysis` — LLM-анализы креативов
- `creative_scores` — risk scores
- `creative_tests` — A/B тесты
- `creative_metrics_history` — исторические метрики
- `ad_creative_mapping` — связь объявлений и креативов

### Metrics
- `direction_metrics_rollup` — дневной rollup метрик по направлениям (Two-Stage Retrieval)
- `creative_metrics_history` — ежедневные снимки метрик по объявлениям
- `scoring_executions` — результаты scoring job (scoring_output содержит готовую выжимку)

---

## Добавление нового агента

1. Создать папку `agents/{agent_name}/`
2. Создать файлы:
   - `index.js` — класс агента (extends BaseAgent)
   - `tools.js` — определения инструментов
   - `handlers.js` — обработчики
   - `prompt.js` — системный промпт
3. Зарегистрировать в `orchestrator/index.js`
4. Добавить keywords в `orchestrator/classifier.js`
5. Обновить `getAvailableDomains()`

---

## Добавление нового инструмента

1. Добавить определение в `tools.js`:
```javascript
{
  name: 'toolName',
  description: 'Описание инструмента',
  parameters: {
    type: 'object',
    properties: { ... },
    required: ['param1']
  }
}
```

2. Добавить handler в `handlers.js`:
```javascript
async toolName({ param1, param2 }, { accessToken, adAccountId, userAccountId }) {
  // Реализация
  return { success: true, data: ... };
}
```

3. Для WRITE tools — добавить в массив `*_WRITE_TOOLS`
4. Для опасных операций — добавить в `*_DANGEROUS_TOOLS`

---

## Streaming и Persistence

### Архитектура Streaming

```
Telegram/Web Message
       │
       ▼
┌──────────────────┐
│ TelegramHandler  │  ← handleTelegramMessage()
│ или Web API      │  ← processChat()
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  UnifiedStore    │  ← Единый persistence layer
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Orchestrator    │  ← processStreamRequest() (async generator)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    BaseAgent     │  ← processStreamLoop() (multi-round tool loop)
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────────┐
│Telegram│ │ Web Modal    │
│Streamer│ │ Approval     │
└────────┘ └──────────────┘
```

### UnifiedStore (Unified Persistence Layer)

**Путь:** `services/agent-brain/src/chatAssistant/stores/unifiedStore.js`

Единый store для Web и Telegram. Заменяет старый `conversationStore.js`.

**Основные методы:**
| Метод | Описание |
|-------|----------|
| `getOrCreate({ source, userAccountId, adAccountId, telegramChatId })` | Получить или создать диалог |
| `getById(conversationId)` | Получить диалог по ID |
| `loadMessages(conversationId, limit)` | Загрузить последние N сообщений (OpenAI формат) |
| `addMessage(conversationId, message)` | Добавить сообщение |
| `addMessages(conversationId, messages)` | Batch insert сообщений |
| `acquireLock(conversationId)` | Захватить mutex (concurrency) |
| `releaseLock(conversationId)` | Освободить mutex |
| `clearMessages(conversationId)` | Очистить историю |
| `setMode(conversationId, mode)` | Изменить режим (auto/plan/ask) |
| `updateRollingSummary(conversationId, summary)` | Обновить саммари |
| `updateMetadata(conversationId, { lastAgent, lastDomain })` | Обновить метаданные |

**Методы для планов:**
| Метод | Описание |
|-------|----------|
| `createPendingPlan(conversationId, planJson, options)` | Создать план для approval |
| `getPendingPlan(conversationId)` | Получить pending план |
| `getPendingPlanById(planId)` | Получить план по ID |
| `approvePlan(planId)` | Одобрить план |
| `rejectPlan(planId)` | Отклонить план |
| `startExecution(planId)` | Начать выполнение |
| `completeExecution(planId, results)` | Завершить выполнение |
| `failExecution(planId, results)` | Отметить ошибку |
| `updateTelegramMessageId(planId, messageId, chatId)` | Сохранить ID сообщения с inline кнопками |

### PlanExecutor

**Путь:** `services/agent-brain/src/chatAssistant/planExecutor.js`

Выполняет одобренные планы.

**Методы:**
| Метод | Описание |
|-------|----------|
| `executeFullPlan({ planId, toolContext, onStepStart, onStepComplete })` | Выполнить все шаги плана |
| `executeSingleStep({ planId, stepIndex, toolContext })` | Выполнить один шаг |

### Таблицы Persistence (Unified Schema)

```sql
-- Диалоги (Web и Telegram)
ai_conversations (
  id UUID PRIMARY KEY,
  user_account_id UUID NOT NULL,
  ad_account_id UUID,
  title TEXT,
  mode TEXT,            -- 'auto' | 'plan' | 'ask'
  source TEXT,          -- 'web' | 'telegram'
  telegram_chat_id TEXT,
  is_processing BOOLEAN,  -- mutex для concurrency
  rolling_summary TEXT,   -- саммари старых сообщений
  last_agent TEXT,
  last_domain TEXT,
  created_at, updated_at
)

-- Сообщения
ai_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID,
  role TEXT,            -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT,
  plan_json JSONB,      -- для Web approval modal
  actions_json JSONB,
  tool_calls JSONB,     -- [{name, arguments, id}]
  tool_call_id TEXT,
  tool_name TEXT,
  tool_result JSONB,
  agent TEXT,
  domain TEXT,
  tokens_used INTEGER,
  created_at
)

-- Планы для approval (Web modal / Telegram inline keyboard)
ai_pending_plans (
  id UUID PRIMARY KEY,
  conversation_id UUID,
  plan_json JSONB,      -- { steps: [{action, params, description}], summary }
  status TEXT,          -- 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'expired'
  source TEXT,          -- 'web' | 'telegram'
  telegram_chat_id TEXT,
  telegram_message_id BIGINT,  -- ID сообщения с inline кнопками
  execution_results JSONB,
  created_at, resolved_at
)
```

### TelegramStreamer

**Путь:** `services/agent-brain/src/chatAssistant/telegramStreamer.js`

Обрабатывает события streaming с debounce 500ms:

| Event Type | Описание |
|------------|----------|
| `text` | Chunk текста от LLM |
| `tool_start` | Начало выполнения tool |
| `tool_result` | Результат tool |
| `approval_required` | Требуется подтверждение |
| `done` | Завершение |
| `error` | Ошибка |

### Telegram Approval (Inline Keyboard)

**Путь:** `services/agent-brain/src/chatAssistant/telegram/approvalHandler.js`

При требовании approval отправляются inline кнопки:
```
📋 Требуется подтверждение

Действия:
1. ⚠️ pauseDirection (direction_id: xxx)
2. updateBudget (amount: 500)

[✅ Выполнить] [❌ Отменить]
```

**Методы:**
| Метод | Описание |
|-------|----------|
| `sendApprovalButtons(ctx, plan, planId)` | Отправить сообщение с inline keyboard |
| `handleApprovalCallback(ctx, callbackQuery)` | Обработать нажатие кнопки |
| `handleTextApproval(ctx, text, conversationId)` | Fallback: текстовые команды "да"/"нет" |

### API Endpoints

**Telegram:**
```
POST /api/brain/telegram/chat
  body: { telegramChatId, message }
  → Обработать сообщение (streaming в Telegram)

POST /api/brain/telegram/clear
  body: { telegramChatId }
  → Очистить историю

POST /api/brain/telegram/mode
  body: { telegramChatId, mode }
  → Изменить режим

GET /api/brain/telegram/status?telegramChatId=...
  → Получить статус диалога
```

**Web:**
```
POST /api/brain/chat/message
  body: { message, conversationId?, mode?, userAccountId, adAccountId }
  → Обработать сообщение

POST /api/brain/chat/execute
  body: { conversationId, userAccountId, adAccountId }
  → Выполнить весь план (approve all)

POST /api/brain/chat/execute-action
  body: { conversationId, actionIndex, userAccountId, adAccountId }
  → Выполнить одно действие из плана
```

### Dangerous Tools (100% confirmation)

Эти tools ВСЕГДА требуют подтверждения:

| Tool | Причина |
|------|---------|
| `pauseCampaign` | Останавливает рекламу |
| `pauseDirection` | Останавливает направление + FB адсет |
| `updateBudget` | Изменение бюджета |
| `pauseCreative` | Останавливает все объявления |
| `sendBulkMessage` | Массовая рассылка |

---

## Telegram команды

| Команда | Описание |
|---------|----------|
| `/clear` | Очистить историю диалога |
| `/mode auto\|plan\|ask` | Изменить режим |
| `/status` | Показать статус диалога |

---

## Approval Flow

### Web (Modal)
```
User Request → LLM → plan_json в ai_messages
                         │
                         ▼
              ┌─────────────────────┐
              │  Web Modal          │
              │  [Approve] [Cancel] │
              └─────────────────────┘
                         │
              POST /execute или /execute-action
                         │
                         ▼
              ┌─────────────────────┐
              │   PlanExecutor      │
              │   executeFullPlan() │
              └─────────────────────┘
```

### Telegram (Inline Keyboard)
```
User Request → LLM → approval_required event
                         │
                         ▼
              ┌─────────────────────────────┐
              │  Telegram Inline Keyboard   │
              │  [✅ Выполнить] [❌ Отменить] │
              └─────────────────────────────┘
                         │
              callback_query: approve:planId
                         │
                         ▼
              ┌─────────────────────┐
              │   PlanExecutor      │
              │   executeFullPlan() │
              └─────────────────────┘
                         │
                         ▼
              editMessageText(результат)
```

### Fallback (Text Approval)
Если inline keyboard не работает:
- "да", "yes", "ок", "подтверждаю" → approve
- "нет", "no", "отмена", "отменить" → reject

---

## Память (Memory Layers)

Chat Assistant использует 3-уровневую систему памяти:

### Session Memory (focus_entities)

**Хранение:** `ai_conversations.focus_entities JSONB`

Контекст текущего диалога — о чём говорим, какой период, какая кампания.

```json
{
  "campaignId": "123",
  "directionId": "456",
  "dialogPhone": "+77001234567",
  "period": "2024-01-01:2024-01-07"
}
```

**Автоматическое обновление** при вызове tools:
- `getCampaignDetails(id)` → `campaignId`
- `getDialogMessages(phone)` → `dialogPhone`
- `getDirectionDetails(id)` → `directionId`
- Любой date-range запрос → `period`

**Методы UnifiedStore:**
| Метод | Описание |
|-------|----------|
| `getFocusEntities(conversationId)` | Получить текущий контекст |
| `updateFocusEntities(conversationId, entities)` | Merge с существующими |
| `clearFocusEntities(conversationId)` | Очистить контекст |

---

### Procedural Memory (Business Specs)

**Хранение:** `user_briefing_responses` — расширенные поля

Бизнес-правила — как устроена воронка, какие KPI, откуда брать данные.

| Поле | Описание | Пример |
|------|----------|--------|
| `tracking_spec` | Настройки атрибуции | `{"utm_ad_id_field": "utm_content", "phone_normalization": {"country": "KZ"}}` |
| `crm_spec` | Этапы воронки, сигналы | `{"pipeline_stages": [...], "hot_signals": [...]}` |
| `kpi_spec` | Глобальные KPI | `{"target_cpl_max": 5000, "priority_services": [...]}` |

**Мультиаккаунтность:**
- Legacy (`account_id = NULL`) → один бриф на user
- Multi-account → бриф per ad_account

**Метод ContextGatherer:**
```javascript
const specs = await getSpecs(userAccountId, accountId);
// { tracking: {}, crm: {}, kpi: {} }
```

---

### Semantic Memory (Dialog Search)

**Хранение:** `dialog_analysis` — расширенные поля

Поиск по истории диалогов — "найди где жаловались на цену".

| Поле | Описание |
|------|----------|
| `summary TEXT` | Краткое резюме диалога (FTS индекс, Russian config) |
| `tags TEXT[]` | Теги для фильтрации (GIN индекс) |
| `insights_json JSONB` | Структурированные инсайты: objections, interests, next_action |

**Пример:**
```sql
summary = 'Клиент интересовался имплантацией, возражал по цене, просил рассрочку'
tags = ['имплантация', 'возражение:цена', 'рассрочка']
insights_json = {"objections": ["дорого"], "interests": ["имплантация"]}
```

**Tool WhatsAppAgent:**
```javascript
searchDialogSummaries({ query, tags, limit })
// Поиск по резюме (FTS) и/или тегам
```

---

### Mid-Term Memory (Agent Notes)

**Хранение:** `user_briefing_responses.agent_notes JSONB`

Накопленные наблюдения агентов — инсайты, паттерны, выводы из анализа данных.

**Структура:**
```json
{
  "ads": {
    "notes": [
      {
        "id": "uuid",
        "text": "Высокий CPL: 1200₽ за период 2024-12-01 - 2024-12-07",
        "source": { "type": "tool", "ref": "getSpendReport" },
        "importance": 0.7,
        "created_at": "2024-12-13T10:00:00Z"
      }
    ],
    "updated_at": "2024-12-13T10:00:00Z"
  },
  "creative": { "notes": [], "updated_at": null },
  "whatsapp": { "notes": [], "updated_at": null },
  "crm": { "notes": [], "updated_at": null }
}
```

**Домены:**
| Домен | Что capture-им |
|-------|---------------|
| `ads` | CPL тренды, проблемные кампании, лучшие направления |
| `creative` | Топ-креативы, underperformers, эффективные хуки/углы |
| `whatsapp` | Возражения клиентов, интересы, боли |
| `crm` | Узкие места воронки, причины потерь, hot сегменты |

**Auto-capture:**

Агенты автоматически сохраняют заметки после выполнения tools:

| Agent | Tool | Что capture-ит |
|-------|------|---------------|
| AdsAgent | `getSpendReport` | Высокий CPL (>1000₽), нет лидов при большом расходе, лучшая кампания |
| AdsAgent | `getDirections` | Много паузнутых направлений |
| CreativeAgent | `getCreativeMetrics` | Топ-креатив, креативы без лидов |
| CreativeAgent | `analyzeCreative` | Эффективные хуки и углы |
| WhatsAppAgent | `analyzeDialog` | Возражения, интересы, боли клиента |
| CRMAgent | `getFunnelStats` | Высокий отвал на этапе, много холодных лидов |
| CRMAgent | `getLeadDetails` | Причины потери лидов |

**Реализация в BaseAgent:**
```javascript
// После выполнения tool
const notes = this.extractNotes(toolName, args, result);
if (notes.length > 0) {
  await memoryStore.addNotes(userAccountId, adAccountId, this.domain, notes);
}
```

**Управление через чат:**

| Команда | Описание |
|---------|----------|
| `Запомни: <текст>` | Сохранить заметку вручную |
| `Забудь: <текст>` | Удалить заметки по совпадению |
| `Что ты помнишь?` | Показать все заметки |

**MemoryStore:**

**Путь:** `services/agent-brain/src/chatAssistant/stores/memoryStore.js`

| Метод | Описание |
|-------|----------|
| `getSpecs(userAccountId, accountId)` | Получить business specs |
| `getAllNotes(userAccountId, accountId)` | Все заметки всех доменов |
| `getNotes(userAccountId, accountId, domain)` | Заметки одного домена |
| `getNotesDigest(userAccountId, accountId, domains, maxPerDomain)` | Digest для промптов (отсортированные по importance) |
| `addNote(userAccountId, accountId, domain, note)` | Добавить заметку |
| `addNotes(userAccountId, accountId, domain, notes)` | Batch добавление |
| `removeNote(userAccountId, accountId, domain, noteId)` | Удалить по ID |
| `removeNoteByText(userAccountId, accountId, searchText)` | Удалить по тексту |
| `clearNotes(userAccountId, accountId, domain)` | Очистить домен |
| `listNotesSummary(userAccountId, accountId)` | Статистика заметок |

**Лимиты:**
- Max 20 заметок на домен
- При превышении — удаляются старые с низким importance
- Дедупликация по тексту

**Подмешивание в промпты:**

В каждом агенте notes инжектятся в system prompt:

```javascript
// В prompt.js каждого агента
import { formatNotesContext } from '../../shared/memoryFormat.js';

const notesContext = formatNotesContext(context?.notes, 'ads');
// → "## Накопленные наблюдения\n• ⭐ Высокий CPL: 1200₽...\n• Лучшая кампания..."
```

---

### Rolling Summary (Long Conversations)

**Путь:** `services/agent-brain/src/chatAssistant/shared/summaryGenerator.js`

LLM-компрессия старых сообщений для поддержания контекста в длинных диалогах.

**Хранение:** `ai_conversations.rolling_summary TEXT`

**Когда обновляется:**
- Сообщений > 20 И последнее обновление > 10 сообщений назад
- ИЛИ token budget utilization > 90%

**Методы:**
| Метод | Описание |
|-------|----------|
| `shouldUpdateSummary(conversation, messageCount, tokenStats)` | Проверить нужно ли обновлять |
| `generateSummary(existingSummary, messages)` | LLM-компрессия через gpt-4o-mini |
| `maybeUpdateRollingSummary(conversationId, messages, tokenStats)` | Автообновление после обработки |
| `getSummaryContext(conversationId)` | Получить summary для prompt |
| `formatSummaryForPrompt(summary)` | Форматирование для инъекции |

**LLM Prompt:**
```
Сожми диалог в краткое резюме (макс 500 слов).
Сохрани:
- О чём говорили (кампании, креативы, лиды)
- Какие действия выполнялись
- Какие решения приняты
- Контекст для продолжения
```

**Интеграция:**
```javascript
// В Orchestrator после обработки запроса (async, don't wait)
maybeUpdateRollingSummary(conversationId, conversationHistory, contextStats)
  .catch(err => logger.warn('Failed to update rolling summary'));
```

---

### Business Snapshot (Snapshot-First Pattern)

**Путь:** `services/agent-brain/src/chatAssistant/contextGatherer.js`

Агрегированный snapshot бизнес-данных, загружаемый ДО классификации запроса.

**Структура snapshot:**
```javascript
{
  ads: {
    period: 'last_7d',
    spend: 15000,
    leads: 45,
    cpl: 333,
    activeAdsets: 5,
    activeCreatives: 12,
    topAdset: { name: '...', cpl: 250 },
    worstAdset: { name: '...', cpl: 800 },
    dataDate: '2024-12-13T08:00:00Z'
  },
  directions: {
    count: 5,
    totalSpend: 15000,
    totalLeads: 45,
    topDirection: { id: '...', cpl: 200 },
    worstDirection: { id: '...', cpl: 600 }
  },
  creatives: {
    totalWithScores: 20,
    avgRiskScore: 45,
    highRiskCount: 3,
    highRiskCreatives: [{ id, score, verdict }]
  },
  notes: {
    ads: [{ text: '...' }],
    creative: [{ text: '...' }]
  },
  generatedAt: '2024-12-13T10:00:00Z',
  latencyMs: 150,
  freshness: 'fresh' | 'stale' | 'outdated' | 'missing'
}
```

**Freshness:**
| Значение | Описание |
|----------|----------|
| `fresh` | Данные < 24 часов |
| `stale` | Данные 24-48 часов |
| `outdated` | Данные > 48 часов |
| `missing` | Нет данных |

**Методы:**
| Метод | Описание |
|-------|----------|
| `getBusinessSnapshot({ userAccountId, adAccountId })` | Получить snapshot |
| `formatSnapshotForPrompt(snapshot)` | Форматировать для system prompt |

**Интеграция в Orchestrator:**
```javascript
// Загрузка в параллели с memory
const [specs, notes, summaryContext, snapshot] = await Promise.all([
  memoryStore.getSpecs(...),
  memoryStore.getNotesDigest(...),
  getSummaryContext(...),
  getBusinessSnapshot({ userAccountId, adAccountId })
]);

// Добавление в контекст
const enrichedContext = {
  ...context,
  businessSnapshot: snapshot,
  businessSnapshotFormatted: formatSnapshotForPrompt(snapshot)
};

// Трекинг для runsStore
toolContext.contextStats = {
  snapshotUsed: snapshot?.freshness !== 'error',
  snapshotFreshness: snapshot?.freshness
};
```

---

### AI Runs (LLM Tracing)

**Путь:** `services/agent-brain/src/chatAssistant/stores/runsStore.js`

Полная трассировка LLM вызовов для дебага и аудита.

**Хранение:** `ai_runs` таблица

**Таблица:**
```sql
ai_runs (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES ai_conversations(id),
  message_id UUID REFERENCES ai_messages(id),
  user_account_id UUID NOT NULL,

  -- LLM info
  model TEXT NOT NULL,
  agent TEXT,
  domain TEXT,
  user_message TEXT,

  -- Tokens
  input_tokens INTEGER,
  output_tokens INTEGER,

  -- Tools
  tools_planned JSONB DEFAULT '[]',     -- [{name, args}]
  tools_executed JSONB DEFAULT '[]',    -- [{name, args, success, latency_ms}]
  tool_errors JSONB DEFAULT '[]',       -- [{name, error}]

  -- Context
  context_stats JSONB,                  -- {snapshotUsed, rollingSummaryUsed, freshness}
  snapshot_used BOOLEAN DEFAULT false,
  rolling_summary_used BOOLEAN DEFAULT false,

  -- Performance
  latency_ms INTEGER,

  -- Status
  status TEXT DEFAULT 'pending',        -- pending | completed | error
  error_message TEXT,
  error_code TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
)
```

**Методы runsStore:**
| Метод | Описание |
|-------|----------|
| `create({ conversationId, userAccountId, model, agent, domain })` | Создать запись run |
| `updateContextStats(runId, stats)` | Обновить статистику контекста |
| `recordToolsPlanned(runId, toolCalls)` | Записать планируемые tools |
| `recordToolExecution(runId, { name, args, success, latencyMs })` | Записать выполненный tool |
| `complete(runId, { inputTokens, outputTokens, latencyMs })` | Завершить успешно |
| `fail(runId, { errorMessage, errorCode, latencyMs })` | Записать ошибку |
| `getForConversation(conversationId, limit)` | Получить runs диалога |
| `getStatsSummary(conversationId)` | Агрегированная статистика |
| `cleanup(olderThanDays)` | Очистить старые записи |

**Интеграция в BaseAgent:**
```javascript
async callLLMWithTools(messages, toolContext, mode) {
  // Create run record
  const run = await runsStore.create({
    conversationId: toolContext.conversationId,
    userAccountId: toolContext.userAccountId,
    model: MODEL,
    agent: this.name,
    domain: this.domain
  });

  try {
    // ... execute LLM call ...

    // Record tool executions
    for (const toolCall of assistantMessage.tool_calls) {
      const result = await this.executeTool(toolName, toolArgs, toolContext);
      await runsStore.recordToolExecution(run.id, {
        name: toolName,
        args: toolArgs,
        success: result.success,
        latencyMs: Date.now() - toolStartTime
      });
    }

    // Complete on success
    await runsStore.complete(run.id, {
      inputTokens: completion.usage.prompt_tokens,
      outputTokens: completion.usage.completion_tokens,
      latencyMs: Date.now() - startTime
    });

  } catch (error) {
    await runsStore.fail(run.id, {
      errorMessage: error.message,
      latencyMs: Date.now() - startTime
    });
    throw error;
  }
}
```

---

## Reliability Layer (P0)

### Tool Validation (Zod)

**Путь:** `services/agent-brain/src/chatAssistant/shared/toolRegistry.js`

Централизованная валидация аргументов tools через Zod schemas. Единый источник правды — `toolDefs.js` файлы.

**Zod-first архитектура:**
```
toolDefs.js (Zod schemas) → runtime validation
                         → OpenAI JSON Schema (future)
```

**Tool Definitions:**
| Файл | Tools | Описание |
|------|-------|----------|
| `agents/ads/toolDefs.js` | 15 | Кампании, направления, бюджеты |
| `agents/creative/toolDefs.js` | 15 | Креативы, тесты, анализ |
| `agents/crm/toolDefs.js` | 4 | Лиды, воронка |
| `agents/whatsapp/toolDefs.js` | 4 | Диалоги, поиск |

**Пример toolDef:**
```javascript
import { z } from 'zod';

export const AdsToolDefs = {
  getCampaigns: {
    description: 'Получить список кампаний',
    schema: z.object({
      period: z.enum(['today', 'yesterday', 'last_7d', 'last_30d']),
      status: z.enum(['ACTIVE', 'PAUSED', 'all']).optional()
    }),
    meta: { timeout: 25000, retryable: true }
  },
  updateBudget: {
    schema: z.object({
      adset_id: z.string().min(1),
      new_budget_cents: z.number().min(500, 'Minimum $5')
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  }
};
```

**Интеграция в BaseAgent.executeTool():**
```javascript
// 1. Validate args
const validation = toolRegistry.validate(name, args);
if (!validation.success) {
  return { success: false, error: validation.error };
}

// 2. Execute with timeout
const result = await withTimeout(
  () => handler(validation.data, context),
  metadata.timeout
);
```

---

### Retry & Timeout

**Путь:** `services/agent-brain/src/chatAssistant/shared/retryUtils.js`

| Функция | Описание |
|---------|----------|
| `withTimeout(fn, ms, name)` | Promise.race с timeout |
| `withRetry(fn, options)` | Retry с exponential backoff |
| `isRetryableError(error)` | Определяет retryable ошибки (429, 5xx, ECONNRESET) |

**Конфигурация:**
```javascript
// defaults
maxRetries: 3
baseDelayMs: 1000
maxDelayMs: 10000
timeoutMs: 30000
```

**Facebook API retry + Circuit Breaker:**

**Путь:** `services/agent-brain/src/chatAssistant/shared/fbGraph.js`

```javascript
export async function fbGraph(method, path, accessToken, params, options) {
  const retryableFn = () => withRetry(
    () => fbGraphInternal(method, path, accessToken, params),
    { maxRetries: 2, timeoutMs: 25000, shouldRetry: isFbRetryable }
  );

  // Wrap with circuit breaker
  return withCircuitBreaker('facebook-graph-api', retryableFn, {
    failureThreshold: 5,
    timeout: 60000,  // 1 min before HALF_OPEN
    successThreshold: 2
  });
}
```

---

### Circuit Breaker

**Путь:** `services/agent-brain/src/chatAssistant/shared/circuitBreaker.js`

Защита от каскадных сбоев при массовых ошибках внешних API.

**States:**
| State | Описание |
|-------|----------|
| `CLOSED` | Нормальная работа, запросы проходят |
| `OPEN` | Превышен порог ошибок, запросы отклоняются |
| `HALF_OPEN` | Тестирование восстановления, ограниченные запросы |

**Конфигурация:**
```javascript
{
  failureThreshold: 5,      // Ошибок до OPEN
  successThreshold: 2,      // Успехов в HALF_OPEN для CLOSED
  timeout: 60000,           // ms до перехода в HALF_OPEN
  volumeThreshold: 5,       // Мин. запросов для расчёта failure rate
  failureRateThreshold: 50  // % ошибок для срабатывания
}
```

**Использование:**
```javascript
import { withCircuitBreaker, getCircuitBreaker } from './circuitBreaker.js';

// Вариант 1: Wrapper
const result = await withCircuitBreaker('facebook', myFn, config);

// Вариант 2: Instance
const breaker = getCircuitBreaker('facebook', config);
const result = await breaker.execute(myFn);

// Мониторинг
const states = getAllCircuitStates();
// { facebook: { state: 'CLOSED', failureCount: 0, ... } }
```

**Обработка CircuitOpenError:**
```javascript
try {
  await fbGraph('GET', 'campaigns', token);
} catch (error) {
  if (error.isCircuitOpen) {
    // "Facebook API временно недоступен. Попробуйте через 45 сек."
    console.log(error.retryAfterMs);
  }
}
```

---

### Tool-call Repair Loop

**Путь:** `services/agent-brain/src/chatAssistant/shared/toolRepair.js`

LLM-based исправление невалидных аргументов tools. До 2 попыток.

**Когда срабатывает:**
- Zod validation вернул ошибку
- Ошибка содержит паттерны: `Invalid arguments`, `required`, `Expected`, `must be`

**Пример flow:**
```
1. LLM вызывает: getCampaigns({ period: "week" })
2. Zod error: "period must be 'today' | 'yesterday' | 'last_7d' | 'last_30d'"
3. Repair prompt → LLM: "Исправь args: { period: 'last_7d' }"
4. Retry с исправленными args
```

**Интеграция в BaseAgent.executeTool():**
```javascript
const validation = toolRegistry.validate(name, args);
if (!validation.success && isRepairableError(validation.error)) {
  const repairResult = await attemptToolRepair({
    toolName: name,
    originalArgs: args,
    validationError: validation.error,
    toolDefinition: toolDef
  });

  if (repairResult.success) {
    // Используем исправленные args
    args = repairResult.repairedArgs;
  }
}
```

---

### Post-check Verification

**Путь:** `services/agent-brain/src/chatAssistant/shared/postCheck.js`

Верификация WRITE операций после выполнения. Проверяет что изменение реально применилось.

**Функции:**
| Функция | Описание |
|---------|----------|
| `verifyCampaignStatus(id, expected, token)` | Проверить статус кампании |
| `verifyAdSetStatus(id, expected, token)` | Проверить статус адсета |
| `verifyAdSetBudget(id, expected, token)` | Проверить бюджет адсета |
| `verifyAdStatus(id, expected, token)` | Проверить статус объявления |
| `verifyDirectionStatus(id, expected)` | Проверить статус направления (Supabase) |
| `verifyDirectionBudget(id, expected)` | Проверить бюджет направления |

**Конфигурация:**
- До 2 попыток проверки
- Пауза между попытками для eventual consistency
- Tolerance 1% для бюджетов (округление)

**Пример использования:**
```javascript
async pauseCampaign({ campaign_id }, { accessToken }) {
  const beforeStatus = await getStatus(campaign_id);

  await fbGraph('POST', campaign_id, accessToken, { status: 'PAUSED' });

  const verification = await verifyCampaignStatus(campaign_id, 'PAUSED', accessToken);

  return {
    success: true,
    message: `Кампания поставлена на паузу`,
    verification: {
      verified: verification.verified,  // true/false
      before: beforeStatus,
      after: verification.after,
      warning: verification.warning      // если не удалось подтвердить
    }
  };
}
```

**Результат в ответе агента:**
```json
{
  "success": true,
  "message": "Кампания 123 поставлена на паузу",
  "verification": {
    "verified": true,
    "before": "ACTIVE",
    "after": "PAUSED"
  }
}
```

---

### Prompt Versioning

**Путь:** `services/agent-brain/src/chatAssistant/agents/*/prompt.js`

Версионирование промптов для отладки и A/B тестирования.

**Версии:**
| Агент | Версия | Файл |
|-------|--------|------|
| AdsAgent | `ads-v1.0` | `ads/prompt.js` |
| CreativeAgent | `creative-v1.0` | `creative/prompt.js` |
| CRMAgent | `crm-v1.0` | `crm/prompt.js` |
| WhatsAppAgent | `whatsapp-v1.0` | `whatsapp/prompt.js` |

**Интеграция:**
```javascript
// В prompt.js
export const PROMPT_VERSION = 'ads-v1.0';

// В index.js агента
import { PROMPT_VERSION } from './prompt.js';
super({
  // ...
  promptVersion: PROMPT_VERSION
});

// Сохраняется в ai_runs
await runsStore.create({
  promptVersion: this.promptVersion,
  // ...
});
```

**Использование для аналитики:**
```sql
SELECT prompt_version, COUNT(*), AVG(latency_ms)
FROM ai_runs
WHERE created_at > now() - interval '7 days'
GROUP BY prompt_version;
```

---

### Token Budgeting

**Путь:** `services/agent-brain/src/chatAssistant/shared/tokenBudget.js`

Приоритетное распределение токенов в контексте. Предотвращает переполнение при длинных чатах.

**Default Budget:**
```javascript
{
  total: 8000,        // Общий бюджет контекста
  systemPrompt: 2000, // Резерв для system prompt
  chatHistory: 3000,  // История сообщений
  specs: 800,         // Business specs
  notes: 600,         // Agent notes
  metrics: 400,       // Today's metrics
  contexts: 400,      // Promotional contexts
  reserved: 800       // Buffer для tool responses
}
```

**Приоритеты блоков:**
| Priority | Block | Описание |
|----------|-------|----------|
| 10 | recentMessages | История чата (most important) |
| 8 | todayMetrics | Текущие метрики |
| 6 | businessProfile | Профиль бизнеса |
| 4 | activeContexts | Промо-контексты |

**Trimming:**
- Arrays: удаляются старые элементы (с начала)
- Objects: truncate длинных строк
- При превышении лимита — блоки с низким приоритетом отбрасываются

**Интеграция в contextGatherer:**
```javascript
const tokenBudget = new TokenBudget(budget);
tokenBudget.addBlock('recentMessages', chatHistory, 10);
tokenBudget.addBlock('todayMetrics', metrics, 8);

const { context, stats } = tokenBudget.build();
// stats: { usedTokens, budget, utilization, blocksIncluded }
```

---

### Idempotency Keys

**Путь:** `services/agent-brain/src/chatAssistant/shared/idempotentExecutor.js`

**Хранение:** `services/agent-brain/src/chatAssistant/stores/idempotencyStore.js`

Предотвращает повторное выполнение WRITE операций при retry, double-click и т.д.

**Как работает:**
1. Для каждой WRITE операции генерируется `operation_key` (SHA256 от tool + args + context)
2. Перед выполнением — проверка в `ai_idempotent_operations`
3. Если найдено — возвращается cached результат
4. Если нет — выполняется операция и сохраняется результат
5. Записи автоматически удаляются через 24 часа

**Таблица:**
```sql
ai_idempotent_operations (
  id UUID PRIMARY KEY,
  operation_key TEXT NOT NULL,      -- SHA256 hash
  user_account_id UUID NOT NULL,
  tool_name TEXT NOT NULL,
  tool_args JSONB,
  result JSONB,                     -- cached result
  success BOOLEAN,
  source TEXT,                      -- 'chat_assistant' | 'plan_executor'
  expires_at TIMESTAMPTZ            -- auto-cleanup
)
```

**Использование:**
```javascript
import { executeIdempotent } from '../shared/idempotentExecutor.js';

const result = await executeIdempotent({
  toolName: 'pauseCampaign',
  args: { campaign_id: '123' },
  context: { userAccountId, adAccountId },
  executor: () => handlers.pauseCampaign(args, context)
});

// result.cached = true если вернулся из кэша
```

---

### Dry-run Mode

**Путь:** `services/agent-brain/src/chatAssistant/shared/dryRunHandlers.js`

Режим "сухого запуска" для тестирования WRITE операций без реального выполнения.

**Как включить:**
```javascript
// В запросе
{ message: "...", dryRun: true }

// Или через env
DRY_RUN_MODE=true
```

**Что происходит в dry-run:**
- READ операции выполняются нормально
- WRITE операции возвращают симуляцию результата
- В ответе `{ dryRun: true, wouldExecute: [...] }`

**Пример ответа:**
```json
{
  "dryRun": true,
  "wouldExecute": [
    { "tool": "pauseCampaign", "args": { "campaign_id": "123" } },
    { "tool": "updateBudget", "args": { "adset_id": "456", "amount": 500 } }
  ],
  "message": "Dry-run: 2 операции были бы выполнены"
}
```

---

## Two-Stage Retrieval (Metrics)

Двухуровневая система получения метрик: Rollup (быстро, из БД) → Drilldown (FB API при необходимости).

### Источники данных

| Источник | Обновление | Данные |
|----------|------------|--------|
| `scoring_executions.scoring_output` | Ежедневно 08:00 | Готовая выжимка: adsets, ready_creatives, trends, ROI |
| `direction_metrics_rollup` | После scoring job | Агрегированные метрики по направлениям |
| `creative_metrics_history` | Ежедневно 08:00 | Снимки метрик по объявлениям |
| Facebook API | Real-time | Drilldown при отсутствии данных в rollup |

### getTodayMetrics (Context Gathering)

**Путь:** `services/agent-brain/src/chatAssistant/contextGatherer.js`

Получает агрегированные метрики из `scoring_executions.scoring_output`:

```javascript
// scoring_output содержит готовую выжимку:
{
  adsets: [{
    adset_id, adset_name, campaign_id,
    metrics_last_7d: { impressions, spend, leads, avg_cpl, avg_ctr }
  }],
  ready_creatives: [{
    name, user_creative_id, direction_id,
    creatives: [{ objective, performance: { impressions, spend, leads } }]
  }]
}

// Результат для контекста:
{
  spend: 15000.50,      // Сумма за 7 дней
  leads: 45,
  cpl: 333,
  impressions: 150000,
  clicks: 2500,
  active_adsets: 5,
  active_creatives: 12,
  data_date: "2024-12-13T08:00:00Z",
  period: "last_7d"
}
```

### Direction Metrics Rollup

**Миграция:** `migrations/094_direction_metrics_rollup.sql`

Дневной rollup метрик по направлениям (бизнес-сущности).

**Таблица:**
```sql
direction_metrics_rollup (
  id UUID PRIMARY KEY,
  user_account_id UUID NOT NULL,
  account_id UUID,              -- для мультиаккаунтности
  direction_id UUID NOT NULL,   -- FK → account_directions
  day DATE NOT NULL,

  -- Метрики
  spend NUMERIC,
  impressions BIGINT,
  clicks BIGINT,
  leads BIGINT,
  cpl NUMERIC,
  ctr NUMERIC,
  cpm NUMERIC,

  -- Креативы
  active_creatives_count INTEGER,
  active_ads_count INTEGER,

  -- Delta vs yesterday
  spend_delta NUMERIC,
  leads_delta INTEGER,
  cpl_delta NUMERIC
)
```

**Заполнение:**

SQL-функция `upsert_direction_metrics_rollup()` вызывается после `saveCreativeMetricsToHistory()` в scoring.js:

```javascript
// scoring.js — после сохранения метрик
await supabase.rpc('upsert_direction_metrics_rollup', {
  p_user_account_id: userAccountId,
  p_account_id: accountUUID,
  p_day: yesterdayStr  // дата за которую сохранили метрики
});
```

### getDirectionMetrics (Two-Stage)

**Путь:** `services/agent-brain/src/chatAssistant/agents/ads/handlers.js`

1. **Stage 1 — Rollup (быстро):** Запрос в `direction_metrics_rollup`
2. **Stage 2 — Fallback:** Агрегация из `creative_metrics_history` через `ad_creative_mapping`

```javascript
async getDirectionMetrics({ direction_id, period }, context) {
  // 1. Try rollup first (fast)
  const { data: rollupMetrics } = await supabase
    .from('direction_metrics_rollup')
    .select('*')
    .eq('direction_id', direction_id)
    .gte('day', startDate);

  if (rollupMetrics?.length > 0) {
    return { success: true, source: 'rollup', daily, totals };
  }

  // 2. Fallback: aggregate from creative_metrics_history
  // ... via ad_creative_mapping
  return { success: true, source: 'fallback_aggregation', daily, totals };
}
```

**Ответ содержит:**
- `source`: `'rollup'` или `'fallback_aggregation'`
- `daily`: Метрики по дням с deltas
- `totals`: Агрегированные итоги

---

## Frontend

### Компоненты

| Файл | Описание |
|------|----------|
| `pages/Assistant.tsx` | Главная страница чата |
| `components/assistant/ChatSidebar.tsx` | Список чатов (история диалогов) |
| `components/assistant/ChatMessages.tsx` | Лента сообщений |
| `components/assistant/ChatInput.tsx` | Ввод сообщения + выбор режима |
| `components/assistant/MessageBubble.tsx` | Одно сообщение (user/assistant) |
| `components/assistant/ModeSelector.tsx` | Переключатель режимов (auto/plan/ask) |
| `components/assistant/PlanApprovalModal.tsx` | Окно подтверждения плана |

### Plan Approval Modal

При построении плана (режим `plan`) появляется модальное окно:

| Кнопка | Описание |
|--------|----------|
| **No** | Отменить план |
| **Yes** | Выполнить все шаги плана |
| **Yes + Auto** | Выполнить и автоматически корректировать при ошибках |
| **Yes + Manual** | Подтверждать каждый шаг отдельно |

### API клиент

**Путь:** `services/frontend/src/services/assistantApi.ts`

```typescript
// Основные методы
sendMessage(message, conversationId?, mode?)  // Отправить сообщение
getConversations(limit?)                      // Список чатов
getMessages(conversationId)                   // Сообщения чата
deleteConversation(conversationId)            // Удалить чат
executeAction(conversationId, actionIndex)    // Выполнить действие из плана
executeAllActions(conversationId)             // Выполнить весь план
```

---

## Конфигурация

### Environment Variables (agent-brain)

```bash
# OpenAI
OPENAI_API_KEY=sk-...
CHAT_ASSISTANT_MODEL=gpt-4o           # Модель для Chat Assistant

# Режим работы
CHAT_USE_ORCHESTRATOR=true            # true = многоагентная система (default)
                                      # false = legacy режим с одним агентом
```

### Frontend (.env)

```bash
VITE_BRAIN_API_BASE_URL=http://localhost:7080  # URL agent-brain для локальной разработки
```

---

## Запуск

### 1. Применить миграции

```bash
# В Supabase SQL Editor или через psql
psql $DATABASE_URL < migrations/089_ai_chat_tables.sql
psql $DATABASE_URL < migrations/091_ai_pending_plans.sql
psql $DATABASE_URL < migrations/092_business_memory.sql
psql $DATABASE_URL < migrations/093_idempotent_operations.sql
psql $DATABASE_URL < migrations/094_direction_metrics_rollup.sql
psql $DATABASE_URL < migrations/095_ai_runs.sql
```

### 2. Перезапустить agent-brain

```bash
cd services/agent-brain
npm run dev  # или docker-compose restart agent-brain
```

### 3. Открыть в браузере

```
http://localhost:3001/assistant
```

---

## Примеры использования

### Просмотр данных
```
Пользователь: Покажи расходы за вчера
Ассистент: [AdsAgent → getSpendReport]
  Расходы за вчера: $127
  • Кампания "Имплантация" — $85 (3 лида, CPL $28)
  • Кампания "Виниры" — $42 (1 лид, CPL $42)
```

### Управление кампаниями (режим Plan)
```
Пользователь: Остановить неэффективные кампании
Ассистент: [AdsAgent] Нашёл 2 кампании с CPL > $50:
  1. "Имплантация Москва" — CPL $67
  2. "Виниры СПб" — CPL $52

  📋 План действий:
  1. ⚠️ pauseCampaign("Имплантация Москва")
  2. ⚠️ pauseCampaign("Виниры СПб")

  Ожидаемая экономия: ~$120/день

  [No] [Yes] [Yes+Auto] [Yes+Manual]
```

### Работа с лидами
```
Пользователь: Найди горячих лидов
Ассистент: [CRMAgent → getLeads с interest_level=hot]
  🔥 Горячие лиды (5):
  1. Иван Петров — score 85, этап "Консультация"
  2. Мария Сидорова — score 78, этап "Записана"
  ...
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
  • Расход: $250
  • Лидов: 5

  Лиды из этой кампании:
  1. 🔥 Анна Иванова — score 82
  2. ⚡ Пётр Сидоров — score 54
  ...
```

### Работа с креативами
```
Пользователь: Топ креативы по CPL
Ассистент: [CreativeAgent → getTopCreatives]
  🏆 Топ-5 креативов по CPL:
  1. "Имплантация за 1 день" — CPL $18, 45 лидов
  2. "Белоснежная улыбка" — CPL $22, 32 лида
  ...
```

---

## Troubleshooting

### "No Facebook access token found"
Убедитесь что у пользователя подключён Facebook аккаунт в профиле.

### "Failed to get conversations"
Проверьте что миграции применены и таблицы `ai_conversations`, `ai_messages` существуют.

### Ошибки OpenAI
1. Проверьте `OPENAI_API_KEY` в env
2. Проверьте лимиты API
3. Проверьте логи agent-brain

### Запросы направляются не тому агенту
1. Проверьте логи классификатора (`orchestrator/classifier.js`)
2. Добавьте ключевые слова в `classifier.js`
3. Используйте более явные формулировки в запросе

### Отключить многоагентную систему
```bash
CHAT_USE_ORCHESTRATOR=false
```
Это вернёт legacy режим с одним агентом и всеми инструментами.

### Plan не выполняется после approval
1. Проверьте таблицу `ai_pending_plans` — статус должен быть `approved`
2. Проверьте логи `PlanExecutor`
3. Проверьте что tool handler не возвращает ошибку

---

## Миграции

| Миграция | Описание |
|----------|----------|
| `089_ai_chat_tables.sql` | ai_conversations, ai_messages — основные таблицы чата |
| `091_ai_pending_plans.sql` | ai_pending_plans — планы для approval (Web/Telegram) |
| `092_business_memory.sql` | Session + Procedural + Mid-term + Semantic Memory |
| `093_idempotent_operations.sql` | ai_idempotent_operations — idempotency tracking |
| `094_direction_metrics_rollup.sql` | Direction Metrics Rollup + SQL функция |
| `095_ai_runs.sql` | ai_runs — LLM tracing + summary_message_count |

### 092_business_memory.sql
```sql
-- Session Memory
ALTER TABLE ai_conversations
ADD COLUMN IF NOT EXISTS focus_entities JSONB DEFAULT '{}';

-- Procedural + Mid-term Memory
ALTER TABLE user_briefing_responses
ADD COLUMN IF NOT EXISTS tracking_spec JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS crm_spec JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS kpi_spec JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS agent_notes JSONB DEFAULT '{}';

-- Semantic Memory
ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS summary TEXT,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS insights_json JSONB DEFAULT '{}';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_briefing_user_account ON user_briefing_responses(user_id, account_id);
CREATE INDEX IF NOT EXISTS dialog_analysis_summary_fts ON dialog_analysis USING gin(to_tsvector('russian', COALESCE(summary, '')));
CREATE INDEX IF NOT EXISTS dialog_analysis_tags_idx ON dialog_analysis USING gin(tags);
```

### 094_direction_metrics_rollup.sql
```sql
-- Rollup таблица
CREATE TABLE IF NOT EXISTS direction_metrics_rollup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL,
  account_id UUID,
  direction_id UUID NOT NULL REFERENCES account_directions(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  spend NUMERIC DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  leads BIGINT DEFAULT 0,
  cpl NUMERIC,
  ctr NUMERIC,
  cpm NUMERIC,
  active_creatives_count INTEGER DEFAULT 0,
  active_ads_count INTEGER DEFAULT 0,
  spend_delta NUMERIC,
  leads_delta INTEGER,
  cpl_delta NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint (с учётом NULL account_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_direction_metrics_rollup_unique
ON direction_metrics_rollup (user_account_id, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), direction_id, day);

-- SQL функция заполнения
CREATE OR REPLACE FUNCTION upsert_direction_metrics_rollup(
  p_user_account_id UUID,
  p_account_id UUID,
  p_day DATE DEFAULT CURRENT_DATE - INTERVAL '1 day'
) RETURNS INTEGER AS $$ ... $$ LANGUAGE plpgsql;
```
