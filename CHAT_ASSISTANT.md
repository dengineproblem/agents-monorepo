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

**19 инструментов:**

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
| `getAgentBrainActions` | READ | История действий Brain Agent за период |
| `pauseCampaign` | WRITE | Пауза кампании |
| `resumeCampaign` | WRITE | Возобновление кампании |
| `pauseAdSet` | WRITE | Пауза адсета |
| `resumeAdSet` | WRITE | Возобновление адсета |
| `updateBudget` | WRITE | Изменение бюджета адсета |
| `updateDirectionBudget` | WRITE | Изменение бюджета направления |
| `updateDirectionTargetCPL` | WRITE | Изменение целевого CPL |
| `pauseDirection` | WRITE | Пауза направления + FB адсет |
| `triggerBrainOptimizationRun` | WRITE | Запуск Brain Agent оптимизации (dangerous) |

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
| AdsAgent | `ads-v2.2` | `ads/prompt.js` |
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

### Integrations Check (Preflight)

**Путь:** `services/agent-brain/src/chatAssistant/contextGatherer.js`

Проверка доступных интеграций перед вызовом тулов. Агенты используют эту информацию для preflight checks.

**Функция:**
```javascript
getIntegrations(userAccountId, adAccountId, hasFbToken)
// Returns: { fb: boolean, crm: boolean, roi: boolean, whatsapp: boolean }
```

**Что проверяется:**
| Интеграция | Условие |
|------------|---------|
| `fb` | Есть accessToken |
| `crm` | Есть записи в таблице `leads` |
| `roi` | Есть записи в таблице `purchases` |
| `whatsapp` | Активна интеграция `evolution_api` |

**Использование в AdsAgent:**
- Если `integrations.roi=false` → НЕ вызывать `getROIReport`/`getROIComparison`
- Если `integrations.fb=false` → "Facebook Ads не подключен"

---

### Execution Playbooks (AdsAgent v2.2)

**Путь:** `services/agent-brain/src/chatAssistant/agents/ads/playbooks.js`

Диалоговая стратегия с цепочками диагностики и интерактивными next steps.

**Файлы:**
| Файл | Описание |
|------|----------|
| `playbooks.js` | Execution Playbooks, Interactive Router, Few-Shot примеры |
| `prompt.js` | Интеграция playbooks в системный промпт (v2.2) |

**Принципы:**
1. **Цепочка диагностики**: Brain (вчера) → today → углубление
2. **Context-First**: Данные из контекста (brainActions, scoringDetails) БЕЗ tool calls
3. **Interactive Next Steps**: 2-3 варианта после каждого ответа
4. **Минимум тулов**: Max 2 read-тула на ответ

#### Trend Heuristic

Детерминированное определение `trend_level` из `scoring_output.adsets.trends`:

```
По d3 (если нет — d7, иначе d1):
- declining: ctr_change_pct <= -15 ИЛИ cpm_change_pct >= +20
- improving: ctr_change_pct >= +10 И cpm_change_pct <= +10
- stable: иначе

retention_ok = (risk_score < 50) AND (trend_level != 'declining')
```

#### Execution Playbooks

| Playbook | Вопрос | Цепочка |
|----------|--------|---------|
| A | "Почему мало клиентов?" | brainActions → getDirections → getSpendReport(today) |
| B | "Топ креативов по ROI" | getROIReport (preflight: roi=true) |
| C | "Что Brain делал вчера?" | БЕЗ тулов (context.brainActions) |
| D | "Лиды есть, продаж нет" | CRM: getFunnelStats; WA: getDialogs |
| E | "Какой креатив выгорает?" | БЕЗ тулов (scoring_output.ready_creatives) |

#### Interactive Next-Step Router

После каждого ответа предлагаются 2-3 следующих шага:

| Условие | Next Step |
|---------|-----------|
| `whatsapp=true` + CPL ≤ 130% target | "Разобрать 5 последних переписок?" |
| `crm=true` + лидов много, продаж мало | "Проверим воронку: где просадка?" |
| `roi=true` | "Топ креативов по ROI с рекомендациями?" |
| Только Facebook | "Диагностика: где расход есть, а лидов мало" |

**Формат next steps:**
- 🟢 **Безопасно**: read-only диагностика
- 🟡 **Агрессивно**: изменение бюджетов (dry_run preview)
- 🔍 **Углубиться**: детализация по сущности

#### 18 типовых вопросов

| # | Вопрос | Цепочка тулов |
|---|--------|---------------|
| 1 | Почему мало клиентов? | brainActions → getSpendReport(today) → getDirections |
| 2 | Сколько потратили? | getSpendReport(period) |
| 3 | Сколько лидов и CPL? | getSpendReport(today) → getDirections |
| 4 | Что Brain делал вчера? | БЕЗ тулов (brainActions) |
| 5 | Топ креативов по ROI | getROIReport (если roi=true) |
| 6 | ROI высокий — масштабировать? | getROIReport → правила sample/spend |
| 7 | Лиды есть, продаж нет | CRM: getFunnelStats; WA: getDialogs |
| 8 | Какие направления лучше? | getDirections |
| 9 | Что делать с d2? | getDirections → getCampaigns |
| 10 | Почему CPL вырос? | brainActions → getSpendReport(today vs yesterday) |
| 11 | Худшие кампании | getCampaigns или getSpendReport(campaign) |
| 12 | Какой креатив выгорает? | БЕЗ тулов (scoring_output) |
| 13 | Качество WA-лидов | getSpendReport + analyzeDialog (если wa=true) |
| 14 | Последние диалоги | getDialogs (если wa=true) |
| 15 | Лиды за 7 дней | getLeads (если crm=true) |
| 16 | Сколько денег принесли лиды? | getRevenueStats (если roi=true) |
| 17 | Что улучшить прямо сейчас? | brainActions → getSpendReport(today) |
| 18 | Метрики норм, но лидов мало | getSpendReport → WA/CRM анализ |

**24 Few-Shot примеров** (16 базовых + 8 playbook) включены в промпт.

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

### 096_ai_messages_ui_json.sql
```sql
-- UI Components для rich rendering
ALTER TABLE ai_messages
ADD COLUMN IF NOT EXISTS ui_json JSONB DEFAULT NULL;

COMMENT ON COLUMN ai_messages.ui_json IS 'Structured UI components: cards, tables, buttons, charts';
```

### 097_currency_rates.sql
```sql
-- Курсы валют для динамической конвертации USD→KZT
CREATE TABLE IF NOT EXISTS currency_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(12, 4) NOT NULL,
  source VARCHAR(50) DEFAULT 'exchangerate-api',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_currency, to_currency)
);

-- Initial USD→KZT rate
INSERT INTO currency_rates (from_currency, to_currency, rate, source)
VALUES ('USD', 'KZT', 530.0, 'default')
ON CONFLICT (from_currency, to_currency) DO NOTHING;
```

---

## Entity Linking (Short References)

**Путь:** `services/agent-brain/src/chatAssistant/shared/entityLinker.js`

Система коротких ссылок для удобного обращения к элементам списков.

### Как работает

При выводе списков (кампании, лиды, креативы) каждый элемент получает короткий ref:

| Тип | Ref | Пример |
|-----|-----|--------|
| Кампании | `c1, c2, c3...` | "Покажи детали c2" |
| Направления | `d1, d2, d3...` | "Поставь на паузу d1" |
| Лиды | `l1, l2, l3...` | "Детали l3" |
| Креативы | `cr1, cr2, cr3...` | "Сравни cr1 и cr2" |

### Функции

| Функция | Описание |
|---------|----------|
| `attachRefs(items, type)` | Добавляет `_ref` к каждому элементу |
| `buildEntityMap(items, type)` | Создаёт карту для хранения в focus_entities |
| `resolveRef(input, focusEntities)` | Резолвит "c2", "2", "второй" в entity |

### Пример использования

```javascript
// В handlers.js
import { attachRefs, buildEntityMap } from '../../shared/entityLinker.js';

async getCampaigns(params, context) {
  const campaigns = await fetchCampaigns();

  // Добавляем refs
  const campaignsWithRefs = attachRefs(campaigns, 'c');
  const entityMap = buildEntityMap(campaigns, 'c');

  return {
    success: true,
    campaigns: campaignsWithRefs,
    _entityMap: entityMap  // Сохранится в focus_entities.last_list
  };
}
```

### Хранение

`ai_conversations.focus_entities.last_list` содержит последний выведенный список:

```json
{
  "last_list": [
    { "ref": "c1", "type": "c", "id": "uuid-1", "name": "Имплантация" },
    { "ref": "c2", "type": "c", "id": "uuid-2", "name": "Виниры" }
  ]
}
```

### Интеграция в промпты

```
## Entity Linking — ссылки на сущности
При выводе списков каждый элемент получает короткий ref:
- [c1], [c2] — кампании
- [d1], [d2] — направления
- [l1], [l2] — лиды
- [cr1], [cr2] — креативы

Пользователь может ссылаться на элементы: "поставь на паузу c2", "покажи детали cr1"
```

---

## UI Components (Rich Rendering)

**Путь:** `services/frontend/src/components/assistant/`

Система компонентов для богатого отображения данных в чате.

### Компоненты

| Компонент | Описание |
|-----------|----------|
| `UICard.tsx` | Карточка с метриками и действиями |
| `UITable.tsx` | Сортируемая таблица |
| `UICopyField.tsx` | Поле с кнопкой копирования |
| `UIComponent.tsx` | Router для рендеринга разных типов |

### Хранение

`ai_messages.ui_json` содержит массив UI-компонентов:

```json
[
  {
    "type": "card",
    "data": {
      "title": "Кампания 'Имплантация'",
      "metrics": [
        { "label": "Spend", "value": "$150", "delta": "+12%", "trend": "up" },
        { "label": "Leads", "value": "45" }
      ],
      "actions": [
        { "label": "Пауза", "action": "pauseCampaign", "params": { "id": "123" } }
      ]
    }
  },
  {
    "type": "table",
    "data": {
      "headers": ["Название", "CPL", "Лиды"],
      "rows": [["Имплантация", "$25", "12"], ["Виниры", "$35", "8"]],
      "sortable": true
    }
  }
]
```

### Интеграция в MessageBubble

```tsx
{message.ui_json && message.ui_json.length > 0 && (
  <div className="mt-3 space-y-2">
    {message.ui_json.map((component, idx) => (
      <UIComponent key={idx} component={component} onAction={handleAction} />
    ))}
  </div>
)}
```

### TypeScript типы

```typescript
interface UIComponent {
  type: 'card' | 'table' | 'button' | 'chart' | 'copy_field';
  data: CardData | TableData | ButtonData | ChartData | CopyFieldData;
}

interface CardData {
  title: string;
  subtitle?: string;
  metrics?: { label: string; value: string; delta?: string; trend?: 'up' | 'down' }[];
  actions?: { label: string; action: string; params: Record<string, any> }[];
}
```

---

## Currency Rate CRON (USD→KZT)

**Путь:** `services/agent-brain/src/currencyRateCron.js`

Автоматическое обновление курса USD→KZT раз в сутки.

### CRON расписание

- **Время:** 06:00 по Алмате (UTC+6)
- **API:** `https://api.exchangerate-api.com/v4/latest/USD`
- **Fallback:** При ошибке используется последний известный курс

### Helper функции

**Путь:** `services/agent-brain/src/chatAssistant/shared/currencyRate.js`

| Функция | Описание |
|---------|----------|
| `getUsdToKzt()` | Получить текущий курс (с кэшированием 1 час) |
| `convertUsdToKzt(amount, rate?)` | Конвертировать USD → KZT |
| `convertKztToUsd(amount, rate?)` | Конвертировать KZT → USD |
| `formatCurrency(amount, currency)` | Форматировать: "$25.00" или "150K ₸" |
| `invalidateRateCache()` | Сбросить кэш (для тестов) |

### Использование в handlers

```javascript
import { getUsdToKzt, convertUsdToKzt, formatCurrency } from '../../shared/currencyRate.js';

async getROIReport(params, context) {
  const rate = await getUsdToKzt();
  const spendKzt = convertUsdToKzt(spendUsd, rate);

  return {
    success: true,
    spend_usd: spendUsd,
    spend_kzt: spendKzt,
    spend_formatted: formatCurrency(spendKzt, 'KZT')  // "150K ₸"
  };
}
```

### API endpoint

```
POST /api/currency/update
→ Ручной запуск обновления курса (для тестов)
```

### Таблица

```sql
currency_rates (
  from_currency VARCHAR(3),  -- 'USD'
  to_currency VARCHAR(3),    -- 'KZT'
  rate DECIMAL(12, 4),       -- 530.1234
  source VARCHAR(50),        -- 'exchangerate-api'
  updated_at TIMESTAMPTZ
)
```

---

## Auto-Insights (Промпты агентов)

Агенты автоматически добавляют инсайты и рекомендации при выводе данных.

### Контракт ответа (обязательная структура)

Каждый ответ агента ДОЛЖЕН содержать 4 секции:

| Секция | Описание |
|--------|----------|
| **1. Итог** | 1-2 строки — главный вывод, ключевая метрика |
| **2. Данные** | Таблица или список с refs: [c1], [d1], [cr1], [l1] |
| **3. Инсайты** | Минимум 2: один позитивный + один про риски/ограничения |
| **4. Следующие шаги** | Минимум 2: 🟢 безопасный + 🟡 агрессивный (с предупреждением) |

### Индикаторы

| Индикатор | Значение |
|-----------|----------|
| ⚠️ | Проблема: CPL выше целевого, ROI отрицательный |
| ✅ | Успех: ROI > 100%, CPL ниже целевого |
| 🔥 | Топ / Горячий лид (score 70+) |
| ⚡ | Требует мониторинга / Тёплый лид (score 40-69) |
| ⏰ | Застрял на этапе (>3 дней без движения) |
| ❄️ | Холодный лид (score < 40) |
| 🚨 | Критическая проблема — срочное действие |

### Обязательные предупреждения

| Условие | Текст |
|---------|-------|
| impressions < 1000 | "⚠️ Малый размер выборки — выводы предварительные" |
| leads < 5 | "⚠️ Мало данных для выводов" |
| spend < 5000₸ | "⚠️ Рано делать выводы по ROI" |
| ROI > 200% при spend < 10K₸ | "⚠️ ROI высокий, но выборка маленькая" |
| risk_score > 70 | "⚠️ Высокий риск деградации" |

### ROI Decision Rules (AdsAgent)

Детерминированные флаги:
- `sample_small` = impressions < 1000 OR leads < 5
- `spend_small` = spend < 5000₸
- `retention_ok` = (risk_score < 50) AND (prediction_trend != 'declining')

| Условие | Текст |
|---------|-------|
| sample_small | "⚠️ Малый размер выборки — выводы предварительные" |
| ROI > 100% AND spend_small | "ROI высокий, но spend маленький — рано масштабировать" |
| ROI > 50% AND risk_score > 70 | "⚠️ ROI хороший, но риск высокий — может деградировать" |
| ROI > 50% AND retention_ok | "✅ Хороший ROI + низкий риск — кандидат на масштабирование" |
| ROI < 0% AND spend > 10000₸ | "🚨 Отрицательный ROI при большом spend — срочно остановить" |
| CPL > target_cpl * 1.2 | "⚠️ CPL выше целевого на X% — снизить бюджет" |
| CTR < 1% | "⚠️ Низкий CTR — слабый креатив" |

**Рекомендации по действиям:**

| Статус | Действие |
|--------|----------|
| Кандидат на масштабирование | Увеличить бюджет +10-30% (через dry_run preview) |
| Рано масштабировать | Держать текущий бюджет, набрать данные |
| Может деградировать | Мониторить ежедневно, при ухудшении -20-50% |
| Срочно остановить | Пауза через pauseDirection с dry_run preview |

### Risk Score интерпретация (CreativeAgent)

| risk_score | risk_level | prediction_trend | Интерпретация | Действие |
|------------|------------|------------------|---------------|----------|
| 0-30 | Low | stable/improving | ✅ Стабильный креатив | Можно масштабировать |
| 31-50 | Medium | stable | ⚡ Требует мониторинга | Следить за метриками |
| 51-70 | Medium | declining | ⚠️ Начинает выгорать | Готовить замену |
| 71-100 | High | declining | 🚨 Критический риск | Срочно заменить или остановить |

При выводе креативов ВСЕГДА показывать:
- `risk_score` с интерпретацией
- `prediction_trend` (improving/stable/declining)
- `video_retention` если есть видео (25%, 50%, 75%, 95%)
- `prediction_cpl_expected` — прогноз CPL

### Связь с рекламой (CRMAgent)

| Условие | Инсайт |
|---------|--------|
| hot leads < 10% от total | "⚠️ Мало горячих лидов — проверить таргетинг в рекламе" |
| conversion_rate < 5% | "⚠️ Низкая конверсия в продажи — проблема в обработке или качестве лидов" |
| qualificationRate < 30% | "⚠️ Много некачественных лидов — возможно проблема в креативе" |
| много hot leads + низкий spend | "✅ Есть потенциал масштабирования рекламы" |

### Правило источника данных

**КРИТИЧНО:** Любые числа/проценты/статусы — ТОЛЬКО из tool results.
- Если поля нет в данных — писать `н/д`
- Добавлять insight: "⚠️ Нет данных по [название поля]"
- НИКОГДА не придумывать числа

### Уровень уверенности

В конце каждого ответа агент добавляет строку:

| Условие | Текст |
|---------|-------|
| impressions > 5000 AND leads > 20 | `📊 Уверенность: высокая` |
| impressions > 1000 AND leads > 5 | `📊 Уверенность: средняя` |
| sample_small = true | `📊 Уверенность: низкая` |

### Конфликт-резолвер (Multi-agent синтез)

Если агенты расходятся в выводах — НЕ игнорируем, а разрешаем:

| AdsAgent | CRMAgent | Решение |
|----------|----------|---------|
| "ROI высокий, масштабировать" | "win-rate низкий" | "⚠️ Масштабировать осторожно — проверить таргетинг. 🟡 заблокирован до уточнения качества лидов" |
| "CPL в норме" | "много некачественных лидов" | "⚠️ CPL в норме, но качество низкое — возможно нужна квалификация на этапе рекламы" |
| "креатив выгорает" | "лиды всё ещё горячие" | "Креатив выгорает по метрикам, но качество держится — готовить замену, не останавливать срочно" |
| "spend высокий" | "конверсия высокая" | "Высокий spend оправдан хорошей конверсией — возможно масштабировать" |

При обнаружении конфликта:
- 🟢 Безопасный шаг = консервативный вариант (не масштабировать, мониторить)
- 🟡 Агрессивный шаг = заблокирован или с явным предупреждением о риске

### Валидатор ответов

**Файл:** `services/agent-brain/src/chatAssistant/shared/responseValidator.js`

```javascript
import { validateAgentResponse, isValidResponse } from './shared/responseValidator.js';

// Проверка структуры ответа
const result = validateAgentResponse(content, { agent: 'ads', strict: false });
// {
//   valid: boolean,
//   errors: string[],
//   warnings: string[],
//   stats: { refs: number, insights: number, hasTable: boolean, hasConfidence: boolean }
// }

// Быстрая проверка
const ok = isValidResponse(content);
```

Проверяет:
- Наличие секций (Итог, Инсайты, Следующие шаги)
- Наличие refs в ответе
- Минимум 2 инсайта с эмодзи
- Отсутствие placeholder'ов (X%, X₸)
- Формат уровня уверенности

### Пример структурированного ответа

```
📊 **Итог**: За 7 дней потрачено 79,500₸, 45 лидов, CPL 1,767₸

| Ref | Креатив | ROI | Spend | Risk | Статус |
|-----|---------|-----|-------|------|--------|
| [cr1] | Имплантация за 1 день | +85% | 35K₸ | Low | ✅ Кандидат на масштабирование |
| [cr2] | Белоснежная улыбка | +12% | 28K₸ | Medium | ⚡ Мониторить |
| [cr3] | Виниры премиум | -20% | 16K₸ | High | 🚨 Остановить |

**Инсайты:**
- ✅ cr1 показывает стабильный ROI + низкий риск — можно увеличить бюджет на +20%
- ⚠️ cr3 имеет отрицательный ROI при spend > 10K₸ — рекомендую остановить
- ⚠️ Малый размер выборки на cr2 (800 impressions) — выводы предварительные

**Следующие шаги:**
1. 🟢 Безопасно: Увеличить бюджет cr1 на +10%
2. 🟡 Агрессивно: Увеличить cr1 на +30% и остановить cr3

📊 Уверенность: средняя
```

---

## Brain Rules Integration (AdsAgent v2.0)

**Путь:** `services/agent-brain/src/chatAssistant/shared/brainRules.js`

Унификация логики принятия решений между Brain-агентом (batch утренняя оптимизация) и AdsAgent (интерактивный чат).

### Проблема

- **Brain-агент** (server.js): сложная логика с Health Score, матрицей действий, таймфреймами, scoring данными
- **AdsAgent** (prompt.js v1.0): простые правила ("если CPL > target → снизить")
- Рекомендации AdsAgent могли противоречить тому, что сделал Brain утром

### Решение

AdsAgent v2.0 теперь использует те же правила, что и Brain-агент.

### Shared модуль brainRules.js

**Экспорты:**

| Функция/Константа | Описание |
|-------------------|----------|
| `HS_CLASSES` | Health Score классы: very_good (≥+25), good (+5..+24), neutral (-5..+4), slightly_bad (-25..-6), bad (≤-25) |
| `BUDGET_LIMITS` | Ограничения: +30% max increase, -50% max decrease, $3-$100 range |
| `TIMEFRAME_WEIGHTS` | Веса: yesterday (50%), 3d (25%), 7d (15%), 30d (10%) |
| `getBrainRulesPrompt()` | Текст правил для промпта AdsAgent |
| `formatScoringForPrompt(scoring)` | Форматирование scoring данных (adsets, creatives, trends) |
| `formatBrainActionsForNotes(executions)` | Форматирование истории действий Brain |
| `formatBrainHistoryForPrompt(notes)` | Форматирование истории для промпта |

### Health Score система

HS ∈ [-100; +100] — интегральная оценка эффективности ad set / кампании.

**Компоненты:**
1. **CPL/QCPL gap к таргету** (вес 45)
2. **Тренды** (вес до 15): 3d vs 7d, 7d vs 30d
3. **Диагностика** (до -30): CTR < 1%, CPM > медианы, Frequency > 2
4. **Новизна** (<48ч): множитель 0.7
5. **Объём** (impr < 1000): множитель доверия 0.6...1.0
6. **Today-компенсация**: хорошее сегодня перевешивает плохое вчера

**Матрица действий:**

| HS Класс | Действие |
|----------|----------|
| very_good (≥+25) | Масштабировать +10..+30% |
| good (+5..+24) | Держать; при недоборе +0..+10% |
| neutral (-5..+4) | Держать; проверить "пожирателей" |
| slightly_bad (-25..-6) | Снижать -20..-50%; ротация креативов |
| bad (≤-25) | Пауза или снижение -50% |

### История действий Brain

**Источник:** таблица `brain_executions`

**Функция:** `getRecentBrainActions(userAccountId, adAccountId)`

Запрашивает последние 3 дня действий Brain и форматирует для контекста AdsAgent.

```javascript
// Результат
[
  { text: "[13 дек] Бюджет изменён: 123456 → $15.00", source: {...}, importance: 0.8 },
  { text: "[12 дек] Пауза adset: 789012", source: {...}, importance: 0.8 }
]
```

**Интеграция в orchestrator:**
```javascript
const [specs, notes, summaryContext, snapshot, brainActions] = await Promise.all([
  memoryStore.getSpecs(...),
  memoryStore.getNotesDigest(...),
  getSummaryContext(...),
  getBusinessSnapshot(...),
  getRecentBrainActions(userAccountId, dbAccountId)  // NEW
]);

const enrichedContext = {
  ...context,
  brainActions  // Передаётся в AdsAgent
};
```

### Scoring данные в контексте

**Источник:** `scoring_executions.scoring_output`

`getAdsSnapshot()` теперь возвращает `scoringDetails`:

```javascript
{
  // ... existing aggregates ...
  scoringDetails: {
    adsets: [...],           // Full adsets with trends, metrics
    ready_creatives: [...],   // Creatives with performance data
    unused_creatives: [...]   // Unused creatives for rotation
  }
}
```

**Форматирование для промпта:**
```javascript
const scoringContext = formatScoringForPrompt(
  context?.businessSnapshot?.ads?.scoringDetails
);
// → "**Ad Sets (5):**\n- Имплантация: spend $50, CPL $25 📈\n..."
```

### Защита от конфликтов

AdsAgent теперь учитывает историю Brain:
- Не предлагает повторять недавние действия
- Если бюджет уже снижали — даёт время на стабилизацию
- Если создали новый adset — проверяет результаты прежде чем предлагать ещё

### Файлы

| Файл | Изменение |
|------|-----------|
| `shared/brainRules.js` | **Создан** — общие правила Brain |
| `agents/ads/prompt.js` | **Обновлён** → v2.0, интеграция Brain rules |
| `contextGatherer.js` | **Обновлён** — `getRecentBrainActions()`, `scoringDetails` |
| `orchestrator/index.js` | **Обновлён** — загрузка `brainActions` |

---

## MCP (Model Context Protocol) Integration

MCP — открытый стандарт для подключения AI к внешним инструментам и данным.

### Архитектура

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   agent-brain        │────▶│   OpenAI API    │
│   (React)       │     │   /api/brain/chat    │     │   Responses API │
└─────────────────┘     └──────────────────────┘     └────────┬────────┘
                                                              │
                        ┌──────────────────────┐              │ MCP calls
                        │   MCP Server         │◀─────────────┘
                        │   /mcp endpoint      │
                        │   (embedded)         │
                        └──────────────────────┘
```

**Как это работает:**
1. Frontend вызывает `/api/brain/chat` как раньше
2. agent-brain создаёт MCP session с контекстом пользователя
3. agent-brain вызывает OpenAI Responses API с `tools: [{ type: "mcp" }]`
4. OpenAI **напрямую** вызывает наш MCP server для выполнения tools
5. Результат возвращается через agent-brain в frontend

### Структура файлов

```
services/agent-brain/src/mcp/
├── index.js               # Entry point + MCP_CONFIG
├── server.js              # Fastify routes: POST/GET /mcp
├── protocol.js            # JSON-RPC 2.0 handler
├── sessions.js            # Session management (30 min TTL)
├── tools/
│   ├── definitions.js     # Agent tools → MCP format
│   ├── registry.js        # Tool discovery
│   └── executor.js        # Tool execution with context
└── resources/
    └── registry.js        # Resource definitions (Phase 3)
```

### Session Management

**Проблема:** OpenAI вызывает MCP server напрямую, не зная userAccountId/adAccountId.

**Решение:** Session-based mapping

```javascript
// 1. Создаём сессию перед вызовом OpenAI
const sessionId = createSession({
  userAccountId,
  adAccountId,
  accessToken,
  conversationId
});

// 2. Передаём sessionId в headers
tools: [{
  type: 'mcp',
  server_url: MCP_SERVER_URL,
  headers: { 'Mcp-Session-Id': sessionId }
}]

// 3. MCP server получает контекст из сессии
const session = getSession(sessionId);
// → { userAccountId, adAccountId, accessToken }
```

### MCP Tools (Phase 4: Все агенты)

**Всего: 38 tools** (WhatsApp 4 + CRM 4 + Creative 15 + Ads 15)

#### WhatsApp Agent (4 READ)

| Tool | Описание |
|------|----------|
| `getDialogs` | Список WhatsApp диалогов |
| `getDialogMessages` | Сообщения диалога |
| `analyzeDialog` | AI-анализ диалога |
| `searchDialogSummaries` | Поиск по истории |

#### CRM Agent (3 READ + 1 WRITE)

| Tool | Описание | Тип |
|------|----------|-----|
| `getLeads` | Список лидов | READ |
| `getLeadDetails` | Детали лида | READ |
| `getFunnelStats` | Статистика воронки | READ |
| `updateLeadStage` | Изменить этап лида | WRITE |

#### Creative Agent (10 READ + 5 WRITE)

| Tool | Описание | Тип |
|------|----------|-----|
| `getCreatives` | Список креативов | READ |
| `getCreativeDetails` | Детали креатива | READ |
| `getCreativeMetrics` | Метрики креатива | READ |
| `getCreativeAnalysis` | AI-анализ креатива | READ |
| `getTopCreatives` | Топ креативы | READ |
| `getWorstCreatives` | Худшие креативы | READ |
| `compareCreatives` | Сравнение креативов | READ |
| `getCreativeScores` | Risk scores | READ |
| `getCreativeTests` | Список тестов | READ |
| `getCreativeTranscript` | Транскрипт видео | READ |
| `triggerCreativeAnalysis` | Запуск анализа | WRITE |
| `launchCreative` | Запуск креатива | ⚠️ DANGEROUS |
| `pauseCreative` | Пауза креатива | ⚠️ DANGEROUS |
| `startCreativeTest` | Запуск теста (~$20) | ⚠️ DANGEROUS |
| `stopCreativeTest` | Остановка теста | WRITE |

#### Ads Agent (7 READ + 8 WRITE)

| Tool | Описание | Тип |
|------|----------|-----|
| `getCampaigns` | Список кампаний | READ |
| `getCampaignDetails` | Детали кампании | READ |
| `getAdSets` | Список adsets | READ |
| `getSpendReport` | Отчёт по расходам | READ |
| `getDirections` | Список направлений | READ |
| `getDirectionDetails` | Детали направления | READ |
| `getDirectionMetrics` | Метрики направления | READ |
| `pauseCampaign` | Пауза кампании | ⚠️ DANGEROUS |
| `resumeCampaign` | Возобновление кампании | WRITE |
| `pauseAdSet` | Пауза adset | ⚠️ DANGEROUS |
| `resumeAdSet` | Возобновление adset | WRITE |
| `updateBudget` | Изменение бюджета | ⚠️ DANGEROUS |
| `updateDirectionBudget` | Изменение бюджета направления | ⚠️ DANGEROUS |
| `updateDirectionTargetCPL` | Изменение target CPL | WRITE |
| `pauseDirection` | Пауза направления | ⚠️ DANGEROUS |

### DANGEROUS_TOOLS

Инструменты, требующие подтверждения (тратят бюджет или необратимы):

```javascript
export const DANGEROUS_TOOLS = [
  // Creative (3)
  'launchCreative',      // Тратит бюджет
  'pauseCreative',       // Останавливает рекламу
  'startCreativeTest',   // Тратит ~$20
  // Ads (5)
  'pauseCampaign',       // Останавливает кампанию
  'pauseAdSet',          // Останавливает adset
  'updateBudget',        // Меняет расход
  'updateDirectionBudget', // Меняет расход
  'pauseDirection'       // Останавливает все ads направления
];
```

### MCP Resources (Phase 3)

| URI | Источник | Описание |
|-----|----------|----------|
| `project://metrics/today` | `scoring_executions.scoring_output` | Метрики за 7 дней (spend, leads, CPL, CTR) |
| `project://snapshot/business` | Aggregated | Полный snapshot (ads, directions, creatives, notes) |
| `project://notes/{domain}` | `agent_notes` | Заметки по домену (ads, creative, crm, whatsapp) |
| `project://brain/actions` | `brain_executions` | История Brain за 3 дня |

#### Resource: metrics/today

```javascript
// Возвращает агрегированные метрики из scoring_output
{
  period: 'last_7d',
  spend: 1234.56,
  leads: 50,
  cpl: 24.69,
  impressions: 100000,
  clicks: 5000,
  ctr: 5.0,
  activeAdsets: 5,
  activeCreatives: 12,
  dataDate: '2024-01-15T10:00:00Z'
}
```

#### Resource: snapshot/business

```javascript
// Параллельно загружает 4 секции
{
  ads: { spend, leads, cpl, topAdset, worstAdset, ... },
  directions: { count, totalSpend, topDirection, ... },
  creatives: { totalWithScores, avgRiskScore, highRiskCreatives, ... },
  notes: { ads: [...], creative: [...], ... },
  generatedAt: '2024-01-15T10:00:00Z',
  latencyMs: 150
}
```

#### Resource: notes/{domain}

```javascript
// Заметки агента по домену (max 20)
{
  domain: 'ads',
  notes: [
    { id, text, source, importance, created_at },
    ...
  ],
  total: 15
}
```

#### Resource: brain/actions

```javascript
// История Brain executions за 3 дня
{
  period: 'last_3d',
  executions: [
    { id, status, createdAt, plan, actions },
    ...
  ],
  total: 5
}
```

### Конфигурация

```bash
# .env
MCP_ENABLED=false          # Включить MCP
MCP_SERVER_URL=http://localhost:7080/mcp

# Production (публичный URL для OpenAI)
MCP_SERVER_URL=https://api.yourdomain.com/mcp
```

### Логика обработки

```javascript
// chatAssistant/index.js

if (MCP_CONFIG.enabled) {
  try {
    response = await processChatViaMCP({ ... });
  } catch (mcpError) {
    if (MCP_CONFIG.fallbackToLegacy) {
      // Fallback to orchestrator
      response = null;
    }
  }
}

if (!response) {
  // Standard orchestrator/legacy path
  response = await orchestrator.processRequest({ ... });
}
```

### Endpoints

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/mcp` | POST | JSON-RPC requests от OpenAI |
| `/mcp` | GET | SSE stream (server-initiated) |
| `/mcp/health` | GET | Health check |

### Тестирование

```bash
# 1. Включить MCP
export MCP_ENABLED=true

# 2. Запустить сервер
cd services/agent-brain && npm start

# 3. Health check
curl http://localhost:7080/mcp/health

# 4. Для production — ngrok туннель
ngrok http 7080
# MCP_SERVER_URL=https://abc123.ngrok.io/mcp
```

### Rollback

```bash
# Мгновенный откат через env
MCP_ENABLED=false
```

### Файлы изменений

| Файл | Изменение |
|------|-----------|
| `package.json` | `@modelcontextprotocol/sdk` dependency |
| `server.js` | Import + регистрация MCP routes |
| `chatAssistant/index.js` | `processChatViaMCP()`, MCP логика в `processChat()` |
| `.env` | `MCP_ENABLED`, `MCP_SERVER_URL` |

---

### Phase 2: Качество ответов

#### 2.1 Zod Validation

Валидация аргументов tools через Zod схемы:

```javascript
// mcp/tools/executor.js
import { validateToolArgs } from './executor.js';

// Перед выполнением tool
const validation = validateToolArgs(toolName, args);
if (!validation.success) {
  return {
    isError: true,
    error: 'validation_error',
    message: validation.error,
    field: validation.field
  };
}
```

#### 2.2 Response Formatting

Форматирование ответов MCP с валидацией и entity linking:

```javascript
// mcp/responseFormatter.js
import { formatMCPResponse } from './responseFormatter.js';

const formatted = formatMCPResponse(
  { content: rawContent, toolCalls },
  {
    domain: 'ads',
    validate: true,    // Применить responseValidator
    addRefs: true      // Добавить entity refs [c1], [d1], [cr1]
  }
);

// Результат:
{
  content: '...',      // Отформатированный текст
  entities: [...],     // Найденные сущности
  uiJson: {...},       // Для UI карточек
  validation: {...}    // Результат валидации
}
```

#### 2.3 Streaming Support

Async generator для streaming событий:

```javascript
// mcp/mcpStreamer.js
import { processChatViaMCPStream, collectStreamEvents } from './mcpStreamer.js';

// Streaming events
for await (const event of processChatViaMCPStream({ systemPrompt, userPrompt, toolContext })) {
  switch (event.type) {
    case 'thinking':           // Анализирую запрос...
    case 'classification':     // { domain, confidence, agents }
    case 'tool_start':         // { name, args }
    case 'tool_result':        // { name, result, success }
    case 'approval_required':  // { name, tool, args, reason }
    case 'text':               // { content, accumulated }
    case 'done':               // { content, agent, domain, toolCalls, entities }
    case 'error':              // { error, sessionId }
  }
}

// Или собрать все события
const { events, finalResult } = await collectStreamEvents(stream);
```

**Типы событий:**

| Event | Описание |
|-------|----------|
| `thinking` | Агент обрабатывает запрос |
| `classification` | Определён домен запроса |
| `tool_start` | Начало выполнения tool |
| `tool_result` | Результат tool |
| `approval_required` | Dangerous tool требует подтверждения |
| `text` | Текстовый chunk ответа |
| `done` | Обработка завершена |
| `error` | Произошла ошибка |

---

### Phase 3: Масштабирование

#### 3.1 Redis Sessions

Поддержка Redis для хранения сессий (с fallback на in-memory):

```javascript
// mcp/sessions.js

// Автоматический выбор store
// - REDIS_URL → RedisStore
// - иначе → MemoryStore (Map)

// Sync API (для in-memory совместимости)
const session = getSession(sessionId);

// Async API (для Redis)
const session = await getSessionAsync(sessionId);
await extendSessionAsync(sessionId);
const stats = await getSessionStatsAsync();

// Проверка типа store
const storeType = getStoreType(); // 'redis' | 'memory'
```

**Конфигурация:**

```bash
# .env
REDIS_URL=redis://localhost:6379  # Включает Redis store
# Без REDIS_URL — in-memory fallback
```

**Session TTL:** 15 минут (уменьшено для безопасности)

**Health endpoint:**

```json
GET /mcp/health
{
  "status": "ok",
  "sessions": { "active": 5, "total": 5 },
  "sessionStore": "redis"  // или "memory"
}
```

#### 3.2 Mixed Queries

Обработка запросов, требующих данные из нескольких доменов:

```javascript
// chatAssistant/index.js

// Ограничения для mixed queries:
// - Max 2 домена (больше → общий ответ без tools)
// - Max 3 read-only tools на домен
// - Только READ операции (безопасно)

const MIXED_QUERY_READ_TOOLS = {
  ads: ['getCampaigns', 'getCampaignDetails', 'getAdSets', 'getSpendReport',
        'getDirections', 'getDirectionDetails', 'getDirectionMetrics'],
  creative: ['getCreatives', 'getCreativeDetails', 'getCreativeMetrics',
             'getTopCreatives', 'getWorstCreatives', 'getCreativeScores'],
  crm: ['getLeads', 'getLeadDetails', 'getFunnelStats'],
  whatsapp: ['getDialogs', 'getDialogMessages', 'analyzeDialog', 'searchDialogSummaries']
};
```

**Синтез ответа:**

```javascript
// Для mixed queries добавляются секции по доменам
function synthesizeMixedResponse(content, toolCalls, domains) {
  // Группирует tools по доменам
  // Добавляет заголовки секций: "## Реклама", "## CRM"
  // Возвращает структурированный ответ
}
```

**Пример mixed query:**

```
User: "Покажи расходы за неделю и сколько лидов в CRM"

→ domains: ['ads', 'crm']
→ tools: ['getSpendReport', 'getLeads', 'getFunnelStats']
→ response: секция "Реклама" + секция "CRM"
```

#### 3.3 MCP Resources как контекст

Облегчённый system prompt с ссылками на MCP Resources:

```javascript
// chatAssistant/systemPrompt.js

// Для MCP: минимальный prompt + инструкции по ресурсам
export function buildSystemPromptForMCP(mode, businessProfile) {
  return `${BASE_INSTRUCTIONS}

## MCP Ресурсы
| URI | Описание |
| \`project://metrics/today\` | Метрики за 7 дней |
| \`project://snapshot/business\` | Полный снимок бизнеса |
| \`project://notes/{domain}\` | Заметки агента |
| \`project://brain/actions\` | История автопилота |

**Использование:**
1. Запроси нужный resource через MCP
2. Данные из resource используй для ответа
3. Не запрашивай resource повторно в одном запросе`;
}

// Минимальный user prompt
export function buildUserPromptForMCP(message) {
  return message; // Только сообщение пользователя
}
```

**Преимущества:**
- Меньше токенов в контексте
- Данные загружаются по требованию
- Актуальные данные (не cached snapshot)

---

### Extended Session (Hybrid C)

Расширенная структура сессии для фильтрации и политик:

```javascript
createSession({
  // Core
  userAccountId,
  adAccountId,
  accessToken,
  conversationId,

  // Hybrid C extensions
  allowedDomains: ['ads'],           // От classifier
  allowedTools: ['getCampaigns', ...], // Конкретные tools
  mode: 'auto',                      // auto | plan | ask
  dangerousPolicy: 'block',          // block | allow
  integrations: {                    // Доступные интеграции
    fb: true,
    crm: true,
    roi: true,
    whatsapp: false
  }
});
```

**Фильтрация tools:**

```javascript
// mcp/protocol.js → handleToolsList()
// Возвращает только tools из session.allowedTools

// mcp/tools/executor.js
// Проверяет tool в allowedTools перед выполнением
```

**Approval для DANGEROUS tools:**

```javascript
// При dangerousPolicy: 'block'
if (isDangerousTool(name)) {
  return {
    approval_required: true,
    tool: name,
    args: args,
    reason: 'Это действие требует подтверждения'
  };
}
```

---

### MCP Module Exports

```javascript
// mcp/index.js

// Sessions
export { createSession, getSession, getSessionAsync } from './sessions.js';
export { deleteSession, extendSession, extendSessionAsync } from './sessions.js';
export { getSessionStats, getSessionStatsAsync, getStoreType } from './sessions.js';

// Protocol
export { handleMCPRequest } from './protocol.js';
export { registerMCPRoutes } from './server.js';

// Tools
export { getToolRegistry, getToolHandler, hasToolHandler } from './tools/registry.js';
export { executeToolWithContext, validateToolArgs } from './tools/executor.js';
export { DANGEROUS_TOOLS, isDangerousTool } from './tools/definitions.js';

// Resources
export { getResourceRegistry, readResource } from './resources/registry.js';

// Response & Streaming
export { formatMCPResponse } from './responseFormatter.js';
export { processChatViaMCPStream, collectStreamEvents } from './mcpStreamer.js';

// Config
export const MCP_CONFIG = {
  enabled: process.env.MCP_ENABLED === 'true',
  serverUrl: process.env.MCP_SERVER_URL,
  enabledAgents: ['whatsapp', 'crm', 'creative', 'ads'],
  fallbackToLegacy: true
};
```

---

## Hybrid MCP Executor

**Архитектура:** Orchestrator контролирует логику, MCP выполняет tools.

### Концепция

```
User Message
     ↓
┌─────────────────┐
│   Classifier    │ → domain + intent
└────────┬────────┘
         ↓
┌─────────────────┐
│  PolicyEngine   │ → allowedTools, clarifying
└────────┬────────┘
         ↓
┌─────────────────┐
│ ClarifyingGate  │ → вопросы (если нужны)
└────────┬────────┘
         ↓
┌─────────────────┐
│   MCP Session   │ → tools filtered by policy
└────────┬────────┘
         ↓
┌─────────────────┐
│ResponseAssembler│ → sections, entity refs, ui_json
└─────────────────┘
```

### Файлы модуля

```
chatAssistant/hybrid/
├── index.js              # Экспорты + HYBRID_CONFIG
├── policyEngine.js       # Intent detection + policy resolution
├── toolFilter.js         # Фильтрация tools для OpenAI
├── clarifyingGate.js     # Уточняющие вопросы
└── responseAssembler.js  # Сборка финального ответа
```

---

### Policy Engine (`hybrid/policyEngine.js`)

Определяет allowedTools на основе intent:

```javascript
import { policyEngine } from './hybrid/index.js';

// Detect intent from message
const { intent, domain, confidence } = policyEngine.detectIntent(message);
// → { intent: 'spend_report', domain: 'ads', confidence: 0.9 }

// Resolve policy for intent
const policy = policyEngine.resolvePolicy({
  intent,
  domains: ['ads'],
  context,
  integrations: { fb: true, crm: true }
});
// → {
//     playbookId: 'spend_report',
//     intent: 'spend_report',
//     allowedTools: ['getSpendReport', 'getDirections', 'getCampaigns'],
//     dangerousPolicy: 'block',
//     maxToolCalls: 5,
//     clarifyingRequired: true,
//     clarifyingQuestions: [{ type: 'period', default: 'last_7d' }]
//   }
```

**Маппинг intent → policy:**

| Intent | Domain | allowedTools | clarifying |
|--------|--------|--------------|------------|
| `spend_report` | ads | getSpendReport, getDirections, getCampaigns | period (default) |
| `roi_analysis` | ads | getROIReport, getROIComparison, getDirections | period |
| `budget_change` | ads | updateBudget, updateDirectionBudget, getBudgets | entity, amount, confirm |
| `pause_campaign` | ads | pauseCampaign, getCampaigns | entity, confirm |
| `creative_top` | ads | getTopCreatives, getCreativeMetrics | period, metric |
| `lead_search` | crm | searchLeads, getLeadDetails | entity |
| `brain_history` | brain | - (context only) | нет |

---

### Tool Filter (`hybrid/toolFilter.js`)

Механическое ограничение tools перед OpenAI API:

```javascript
import { filterToolsForOpenAI, validateToolCall, isDangerousTool } from './hybrid/index.js';

// Filter tools before sending to OpenAI
const filteredTools = filterToolsForOpenAI(allTools, policy);
// Только tools из policy.allowedTools

// Validate tool call before execution
const validation = validateToolCall(toolCall, policy);
if (!validation.valid) {
  console.log(validation.reason); // 'Tool not in allowedTools'
}

// Check if tool is dangerous
isDangerousTool('pauseCampaign'); // true
isDangerousTool('getCampaigns');  // false
```

**Dangerous Tools:**
- `pauseCampaign`
- `updateBudget`
- `updateDirectionBudget`
- `deleteCreative`
- `launchCreative`
- `updateAdSet`

---

### Clarifying Gate (`hybrid/clarifyingGate.js`)

Задаёт 1-3 уточняющих вопроса перед выполнением:

```javascript
import { clarifyingGate, QUESTION_TYPES } from './hybrid/index.js';

const result = clarifyingGate.evaluate({
  message: 'покажи расходы',
  policy,
  context,
  existingAnswers: {}
});

if (result.needsClarifying) {
  // Вернуть вопрос пользователю
  return result.formatForUser();
  // → "За какой период показать данные?\n\n1. Сегодня\n2. Вчера\n3. 7 дней\n4. 30 дней"
}

// Продолжить с извлечёнными ответами
const { answers } = result; // { period: 'last_7d' }
```

**Типы вопросов:**

| Тип | Паттерны извлечения | Пример |
|-----|---------------------|--------|
| `PERIOD` | "за неделю", "7 дней", "сегодня" | "last_7d" |
| `ENTITY` | "[d1]", "направление #5", "кампания 123" | `{ type: 'direction', id: '5' }` |
| `AMOUNT` | "5000₽", "+10%", "5к" | `{ value: 5000, currency: 'RUB' }` |
| `METRIC` | "по CPL", "расход" | "cpl" |
| `CONFIRMATION` | "да", "нет", "подтверждаю" | true/false |

**Минимальная агрессивность:**
- READ с defaults: 0-1 вопрос
- READ аналитика: 1 вопрос
- WRITE: 2-3 вопроса (включая confirm)

---

### Response Assembler (`hybrid/responseAssembler.js`)

Форматирует ответ с секциями и entity refs:

```javascript
import { responseAssembler, SECTION_TYPES } from './hybrid/index.js';

const assembled = responseAssembler.assemble(response, {
  policy,
  classification,
  toolResults
});

// assembled = {
//   content: 'Расход за 7 дней: 50,000₽\n\n"Продажа курсов" [c1]: 30,000₽',
//   sections: [
//     { type: 'summary', content: 'Общий расход 50,000₽' },
//     { type: 'data', content: '...' }
//   ],
//   nextSteps: [
//     { text: 'Показать топ расходов', action: 'getTopSpendCampaigns' }
//   ],
//   uiJson: { components: [{ type: 'table', ... }] },
//   metadata: { intent, playbookId, toolsUsed, entityRefs }
// }

// Format for Telegram
const telegram = responseAssembler.formatForTelegram(assembled);
// → { text, ui_json, metadata }
```

**Типы секций:**
- `SUMMARY` - краткий итог
- `DATA` - данные/таблицы
- `INSIGHTS` - инсайты и рекомендации
- `NEXT_STEPS` - следующие шаги

**Entity Refs:**
- `[c1]` - campaign
- `[d1]` - direction
- `[cr1]` - creative
- `[l1]` - lead

---

### Hybrid Flow в Orchestrator

```javascript
// orchestrator/index.js

async processHybridRequest({
  message,
  context,
  mode,
  toolContext,
  conversationHistory,
  clarifyingState
}) {
  // 1. Classify request
  const classification = await classifyRequest(message, context);
  // → { domain: 'ads', agents: ['ads'], intent: 'spend_report' }

  // 2. Resolve policy
  const policy = policyEngine.resolvePolicy({
    intent: classification.intent,
    domains: classification.domains,
    context,
    integrations: toolContext?.integrations
  });

  // 3. Handle context-only (brain_history, etc.)
  if (policy.useContextOnly) {
    return this.handleContextOnlyResponse(message, policy, context);
  }

  // 4. Clarifying Gate
  const clarifyResult = clarifyingGate.evaluate({
    message,
    policy,
    context,
    existingAnswers: clarifyingState?.answers || {}
  });

  if (clarifyResult.needsClarifying) {
    return {
      type: 'clarifying',
      content: clarifyResult.formatForUser(),
      clarifyingState: {
        questions: clarifyResult.questions,
        answers: clarifyResult.answers,
        complete: false
      }
    };
  }

  // 5. Create MCP session with policy
  const sessionId = createSession({
    ...toolContext,
    allowedTools: policy.allowedTools,
    dangerousPolicy: policy.dangerousPolicy,
    policyMetadata: {
      playbookId: policy.playbookId,
      maxToolCalls: policy.maxToolCalls,
      intent: policy.intent
    },
    clarifyingState: clarifyResult
  });

  // 6. Filter tools
  const filteredTools = filterToolsForOpenAI(agent.tools, policy);

  // 7. Execute via MCP
  const response = await processChatViaMCP({
    message,
    conversationHistory,
    systemPrompt,
    tools: filteredTools,
    sessionId
  });

  // 8. Handle approval_required
  if (response.approval_required) {
    return {
      type: 'approval_required',
      tool: response.tool,
      args: response.args,
      content: `Требуется подтверждение: ${response.tool}`
    };
  }

  // 9. Assemble response
  return {
    type: 'response',
    ...responseAssembler.assemble(response, {
      policy,
      classification,
      toolResults: response.executedActions || []
    })
  };
}
```

---

### Интеграция в chatAssistant/index.js

```javascript
import { HYBRID_CONFIG } from './hybrid/index.js';

// В processChatMessage():
if (HYBRID_CONFIG.enabled && USE_ORCHESTRATOR) {
  const response = await orchestrator.processHybridRequest({
    message,
    context,
    mode,
    toolContext,
    conversationHistory,
    clarifyingState: session?.clarifyingState
  });

  // Handle clarifying questions
  if (response.type === 'clarifying') {
    return {
      content: response.content,
      clarifying: true,
      clarifyingState: response.clarifyingState
    };
  }

  // Handle approval required
  if (response.type === 'approval_required') {
    await unifiedStore.savePendingPlan(conversationId, {
      steps: [{ action: response.tool, params: response.args }],
      summary: response.content
    });
    return {
      content: response.content,
      approval_required: true
    };
  }

  // Normal response
  return response;
}
```

---

### Session Extensions для Hybrid

```javascript
// mcp/sessions.js

createSession({
  // ... existing fields

  // Hybrid extensions
  clarifyingState: {
    required: boolean,
    questions: ClarifyingQuestion[],
    answers: Record<string, any>,
    complete: boolean
  },
  policyMetadata: {
    playbookId: string,
    maxToolCalls: number,
    intent: string
  }
});

// Update clarifying state
updateClarifyingState(sessionId, {
  answers: { period: 'last_7d' },
  complete: true
});
```

---

### Configuration

```bash
# Environment Variables

# Enable Hybrid MCP Executor
HYBRID_ENABLED=true

# Clarifying Gate (default: true)
CLARIFYING_GATE_ENABLED=true

# Max tool calls per request (default: 5)
HYBRID_MAX_TOOL_CALLS=5
```

```javascript
// hybrid/index.js

export const HYBRID_CONFIG = {
  enabled: process.env.HYBRID_ENABLED === 'true',
  clarifyingGateEnabled: process.env.CLARIFYING_GATE_ENABLED !== 'false',
  maxToolCalls: parseInt(process.env.HYBRID_MAX_TOOL_CALLS || '5', 10),
  defaultDangerousPolicy: 'block'
};
```

---

### Module Exports

```javascript
// hybrid/index.js

// Phase 1: Policy Engine + Tool Filter
export { PolicyEngine, policyEngine } from './policyEngine.js';
export {
  filterToolsForOpenAI,
  validateToolCall,
  isDangerousTool,
  getToolType,
  getToolsSummary,
  filterReadOnlyTools,
  policyToSessionExtensions
} from './toolFilter.js';

// Phase 2: Clarifying Gate
export {
  ClarifyingGate,
  clarifyingGate,
  QUESTION_TYPES,
  EXTRACTION_PATTERNS
} from './clarifyingGate.js';

// Phase 3: Response Assembler
export {
  ResponseAssembler,
  responseAssembler,
  SECTION_TYPES,
  NEXT_STEP_RULES
} from './responseAssembler.js';

// Config
export { HYBRID_CONFIG };
```

---

### Hybrid MCP: DB Persistence

#### Clarifying State Persistence

**Миграция:** `migrations/098_clarifying_state.sql`

```sql
ALTER TABLE ai_conversations
ADD COLUMN IF NOT EXISTS clarifying_state JSONB NULL,
ADD COLUMN IF NOT EXISTS clarifying_expires_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_ai_conversations_clarifying_active
ON ai_conversations(clarifying_expires_at)
WHERE clarifying_state IS NOT NULL;
```

**UnifiedStore методы:**

| Метод | Описание |
|-------|----------|
| `getClarifyingState(conversationId)` | Получить state с проверкой TTL |
| `setClarifyingState(conversationId, state)` | Сохранить с TTL 30 мин |
| `clearClarifyingState(conversationId)` | Очистить после выполнения |

**Интеграция в Orchestrator:**

```javascript
// На входе processHybridRequest(): загружать state из БД
const clarifyingState = await unifiedStore.getClarifyingState(conversationId);

// При clarifying response: сохранять в БД
await unifiedStore.setClarifyingState(conversationId, {
  questions: result.questions,
  answers: result.answers,
  complete: false
});

// После успешного выполнения: очищать state
await unifiedStore.clearClarifyingState(conversationId);
```

---

### maxToolCalls Enforcement

**Путь:** `mcp/sessions.js` + `mcp/tools/executor.js`

Лимитирование количества tool calls per session:

```javascript
// mcp/sessions.js — новые методы

// Инкремент с проверкой лимита (sync API)
incrementToolCalls(sessionId)
// → { allowed: boolean, used: number, max: number }

// Async версия для Redis
incrementToolCallsAsync(sessionId)

// Статистика без инкремента
getToolCallStats(sessionId)
// → { used: number, max: number }
```

**Проверка в executor.js:**

```javascript
// mcp/tools/executor.js

async function executeToolWithContext(name, args, context) {
  // Check limit before execution
  if (context.sessionId) {
    const limitCheck = context.useRedis
      ? await incrementToolCallsAsync(context.sessionId)
      : incrementToolCalls(context.sessionId);

    if (!limitCheck.allowed) {
      return {
        success: false,
        error: 'tool_call_limit_reached',
        message: `Достигнут лимит вызовов инструментов (${limitCheck.max})`,
        meta: {
          toolCallsUsed: limitCheck.used,
          maxToolCalls: limitCheck.max,
          sessionId: context.sessionId
        }
      };
    }
  }

  // ... execute tool
}
```

**Policy Metadata:**

```javascript
createSession({
  ...toolContext,
  policyMetadata: {
    maxToolCalls: policy.maxToolCalls || 5,
    toolCallCount: 0,
    playbookId: policy.playbookId,
    intent: policy.intent
  }
});
```

---

### runsStore Hybrid Instrumentation

**Миграция:** `migrations/099_ai_runs_hybrid_metadata.sql`

```sql
ALTER TABLE ai_runs
ADD COLUMN IF NOT EXISTS hybrid_metadata JSONB NULL;

CREATE INDEX IF NOT EXISTS idx_ai_runs_hybrid_playbook
ON ai_runs((hybrid_metadata->>'playbookId'))
WHERE hybrid_metadata IS NOT NULL;
```

**Новые методы runsStore:**

| Метод | Описание |
|-------|----------|
| `recordHybridMetadata(runId, metadata)` | Записать metadata: sessionId, allowedTools, playbookId, intent, maxToolCalls |
| `recordHybridError(runId, errorInfo)` | Записать ошибку: limit_reached, not_allowed, approval_required |
| `getHybridStatsByPlaybook(playbookId)` | Статистика по playbook |

**Структура hybrid_metadata:**

```javascript
{
  sessionId: 'uuid',
  allowedTools: ['getSpendReport', 'getDirections'],
  playbookId: 'spend_report',
  intent: 'spend_report',
  maxToolCalls: 5,
  toolCallsUsed: 3,
  clarifyingAnswers: { period: 'last_7d' },
  errors: [{
    type: 'limit_reached',
    tool: 'getCampaigns',
    message: 'Превышен лимит',
    timestamp: '2024-01-15T10:00:00Z'
  }],
  lastError: 'limit_reached',
  recordedAt: '2024-01-15T10:00:00Z'
}
```

**Интеграция в BaseAgent:**

```javascript
// После создания run
if (this.hybridMetadata) {
  await runsStore.recordHybridMetadata(run.id, this.hybridMetadata);
}

// При ошибке tool execution
if (execution.error && this.isHybridError(execution.error)) {
  await runsStore.recordHybridError(run.id, {
    type: this.getHybridErrorType(execution.error),
    tool: toolName,
    message: execution.error.message
  });
}
```

---

### Unit Tests

**Путь:** `services/agent-brain/tests/hybrid/`

```
tests/hybrid/
├── policyEngine.test.js    # detectIntent, resolvePolicy (14 tests)
├── clarifyingGate.test.js  # evaluate, extractFromMessage (10 tests)
├── toolFilter.test.js      # filtering, validation (13 tests)
├── sessions.test.js        # incrementToolCalls (9 tests)
└── integration.test.js     # (future: end-to-end flow)
```

**Запуск тестов:**

```bash
cd services/agent-brain

# Run all tests
npm run test

# Watch mode
npm run test:watch
```

**Vitest конфигурация:**

```javascript
// vitest.config.js
export default {
  test: {
    environment: 'node',
    globals: true
  }
};
```

**Покрытие тестов:**

| Файл | Tests | Описание |
|------|-------|----------|
| `policyEngine.test.js` | 14 | detectIntent (8), resolvePolicy (6) |
| `clarifyingGate.test.js` | 10 | evaluate (4), extractFromMessage (6) |
| `toolFilter.test.js` | 13 | filterToolsForOpenAI (4), validateToolCall (4), isDangerousTool (2), getToolType (2), filterReadOnlyTools (1) |
| `sessions.test.js` | 9 | createSession (2), incrementToolCalls (3), getToolCallStats (2), default maxToolCalls (1), cleanup (1) |

---

### Дополнительные файлы

| Файл | Описание |
|------|----------|
| `mcp/tools/constants.js` | DANGEROUS_TOOLS без тяжёлых зависимостей (для тестов) |
| `frontend/src/types/assistantUI.ts` | QuickActionsData тип |
| `frontend/src/components/assistant/UIComponent.tsx` | UIQuickActions компонент |

---

### Frontend Types для Hybrid

```typescript
// services/frontend/src/services/assistantApi.ts

// Clarifying event type
export interface StreamEventClarifying {
  type: 'clarifying';
  question: string;
  questionType: 'period' | 'entity' | 'amount' | 'metric' | 'confirmation';
  options?: string[];
  required?: boolean;
}

// Quick Actions для nextSteps
export interface QuickActionsData {
  type: 'quick_actions';
  actions: Array<{
    label: string;
    action: string;
    params?: Record<string, unknown>;
    variant?: 'safe' | 'aggressive' | 'neutral';
  }>;
}

// StreamEventType union
export type StreamEventType =
  | 'init'
  | 'thinking'
  | 'classification'
  | 'text'
  | 'tool_start'
  | 'tool_result'
  | 'approval_required'
  | 'clarifying'  // NEW
  | 'done'
  | 'error';
```

---

## Tier-based Playbook Registry (Phase 4-5)

**Архитектура:** Progressive disclosure — от snapshot к actions.

### Концепция Tiers

```
User Message
     ↓
┌─────────────────┐
│ PlaybookRegistry│ → resolve playbook by intent
└────────┬────────┘
         ↓
┌─────────────────┐
│   TierManager   │ → manage tier transitions
└────────┬────────┘
         │
    ┌────┴────┬────────┐
    ▼         ▼        ▼
┌────────┐ ┌────────┐ ┌────────┐
│SNAPSHOT│ │DRILLDOWN│ │ACTIONS│
│read-only│→│expanded │→│dangerous│
│tools   │ │tools    │ │+approval│
└────────┘ └────────┘ └────────┘
```

**3 Tiers:**

| Tier | Tools | Policy | Назначение |
|------|-------|--------|------------|
| `snapshot` | Read-only | `block` dangerous | Быстрый обзор данных |
| `drilldown` | Expanded read | `block` dangerous | Детализация и анализ |
| `actions` | All including write | `require_approval` | Действия с подтверждением |

---

### PlaybookRegistry (`hybrid/playbookRegistry.js`)

10 playbooks для типичных сценариев:

```javascript
import { playbookRegistry, PLAYBOOKS } from './hybrid/index.js';

// Get playbook by ID
const playbook = playbookRegistry.getPlaybook('ads_not_working');

// Get tools for specific tier
const tools = playbookRegistry.getToolsForTier('ads_not_working', 'snapshot');
// → ['getDirections', 'getSpendReport', 'getCampaigns']

// Get policy for tier
const policy = playbookRegistry.getTierPolicy('ads_not_working', 'actions');
// → { dangerousPolicy: 'require_approval', maxToolCalls: 5 }

// Get available next steps
const nextSteps = playbookRegistry.getNextSteps('ads_not_working', snapshotData);
// → [{ id: 'drilldown_creatives', label: 'Посмотреть креативы', targetTier: 'drilldown' }]
```

**Доступные Playbooks:**

| ID | Domain | Intent | Описание |
|----|--------|--------|----------|
| `ads_not_working` | ads | no_results, zero_spend | Реклама не работает |
| `spend_report` | ads | spend_report | Отчёт по расходам |
| `lead_expensive` | crm | expensive_leads | Дорогие лиды |
| `roi_analysis` | ads | roi_report | Анализ ROI |
| `creative_performance` | creative | creative_top | Эффективность креативов |
| `budget_change` | ads | budget_change | Изменение бюджета |
| `pause_campaign` | ads | pause_campaign | Пауза кампании |
| `brain_analysis` | brain | brain_history | Анализ Brain Agent |
| `lead_search` | crm | lead_search | Поиск лидов |
| `general_question` | - | general | Общие вопросы |

---

### Структура Playbook

```javascript
const PLAYBOOK_EXAMPLE = {
  id: 'ads_not_working',
  intents: ['ads_not_working', 'no_results', 'zero_spend'],
  domain: 'ads',

  tiers: {
    snapshot: {
      tools: ['getDirections', 'getSpendReport'],
      maxToolCalls: 4,
      dangerousPolicy: 'block'
    },
    drilldown: {
      tools: ['getCampaigns', 'getAdSets', 'getTopCreatives'],
      maxToolCalls: 5,
      enterIf: ['user_chose_drilldown', 'isHighCPL']
    },
    actions: {
      tools: ['pauseCampaign', 'updateBudget', 'pauseDirection'],
      dangerousPolicy: 'require_approval',
      maxToolCalls: 3
    }
  },

  clarifyingQuestions: [
    { field: 'period', type: 'period', default: 'last_3d', askIf: 'period_not_in_message' },
    { field: 'direction', type: 'entity', askIf: 'directions_count > 1' }
  ],

  nextSteps: [
    { id: 'drilldown_creatives', label: 'Посмотреть креативы', targetTier: 'drilldown', icon: '🎨' },
    { id: 'pause_worst', label: 'Остановить худшие', targetTier: 'actions', icon: '⏸️' }
  ],

  enterConditions: {
    isSmallSample: { expression: 'impressions < 1000' },
    isHighCPL: { expression: 'cpl > targetCpl * 1.3' }
  }
};
```

---

### TierManager (`hybrid/tierManager.js`)

Управление состоянием и переходами между tiers:

```javascript
import { tierManager, TIERS } from './hybrid/index.js';

// Create initial state
const tierState = tierManager.createInitialState('ads_not_working');
// → { playbookId: 'ads_not_working', currentTier: 'snapshot', completedTiers: [], snapshotData: null }

// Check if transition is allowed
const canTransition = tierManager.canTransitionTo(tierState, 'drilldown', snapshotData);
// → true/false

// Execute transition
const newState = tierManager.transitionTo(tierState, 'drilldown', { reason: 'user_choice' });
// → { ...state, currentTier: 'drilldown', completedTiers: ['snapshot'] }

// Save snapshot data for later tiers
tierState = tierManager.saveSnapshotData(tierState, {
  totalSpend: 5000,
  cpl: 25.5,
  impressions: 15000
});

// Evaluate enter conditions
const conditions = tierManager.evaluateEnterConditions('ads_not_working', snapshotData, businessContext);
// → { isHighCPL: true, isSmallSample: false }
```

**Tier State Structure:**

```javascript
{
  playbookId: 'spend_report',
  currentTier: 'snapshot',        // 'snapshot' | 'drilldown' | 'actions'
  completedTiers: [],
  snapshotData: null,             // Результаты snapshot tier
  transitionHistory: [],
  pendingNextStep: null           // Выбранный пользователем next step
}
```

---

### ExpressionEvaluator (`hybrid/expressionEvaluator.js`)

Безопасный eval для условий в playbooks:

```javascript
import { evaluateExpression, evaluateCondition, PRESET_CONDITIONS } from './hybrid/index.js';

// Evaluate simple expression
const result = evaluateExpression('cpl > targetCpl * 1.3', {
  cpl: 25,
  targetCpl: 15
});
// → true

// Evaluate condition with context
const conditionResult = evaluateCondition('isHighCPL', {
  expression: 'cpl > targetCpl * 1.3'
}, context);

// Preset conditions
PRESET_CONDITIONS.isSmallSample({ impressions: 500 });  // true
PRESET_CONDITIONS.isHighCPL({ cpl: 25, targetCpl: 15 }); // true
PRESET_CONDITIONS.isLowROI({ roi: 0.5 });               // true
```

**Поддерживаемые операторы:**
- Сравнение: `>`, `<`, `>=`, `<=`, `===`, `!==`
- Арифметика: `+`, `-`, `*`, `/`
- Логические: `&&`, `||`, `!`

**Безопасность:**
- Whitelist операторов
- Нет eval() / Function()
- Только числа, строки, boolean

---

### UI Components (`hybrid/uiComponents.js`)

Генерация ui_json для Web frontend:

```javascript
import {
  createActionsComponent,
  createChoiceComponent,
  createApprovalComponent,
  createProgressComponent,
  createTableComponent,
  createCardsComponent,
  createMetricComponent,
  createMetricsRowComponent,
  createAlertComponent,
  assembleUiJson,
  createPlaybookNextSteps
} from './hybrid/index.js';

// Actions menu (next steps)
const actions = createActionsComponent({
  title: 'Что сделать дальше?',
  items: [
    { id: 'drilldown', label: 'Детализация', icon: '🔍', payload: { nextStepId: 'drilldown' } },
    { id: 'pause', label: 'Остановить', icon: '⏸️', style: 'danger' }
  ]
});

// Choice for clarifying questions
const choice = createChoiceComponent({
  fieldId: 'period',
  title: 'За какой период?',
  options: [
    { value: 'last_3d', label: '3 дня' },
    { value: 'last_7d', label: '7 дней' }
  ],
  default: 'last_3d'
});

// Approval dialog for dangerous actions
const approval = createApprovalComponent({
  tool: 'pauseCampaign',
  args: { campaign_id: '123' },
  warning: 'Кампания будет остановлена'
});

// Progress indicator
const progress = createProgressComponent({
  currentTier: 'drilldown',
  completedTiers: ['snapshot'],
  playbookId: 'ads_not_working'
});

// Metrics row
const metrics = createMetricsRowComponent([
  { label: 'Расход', value: 5000, unit: '₽', trend: 'up', trendValue: '+15%' },
  { label: 'CPL', value: 25.5, unit: '₽', trend: 'down', trendValue: '-5%' }
]);

// Assemble all components
const uiJson = assembleUiJson([progress, metrics, actions]);
```

**Типы компонентов:**

| Type | Назначение |
|------|------------|
| `actions` | Меню кнопок (next steps) |
| `choice` | Radio/select для вопросов |
| `approval` | Диалог подтверждения |
| `progress` | Индикатор tier |
| `table` | Таблица данных |
| `cards` | Карточки сущностей |
| `metric` | Одна KPI метрика |
| `metrics_row` | Ряд метрик |
| `alert` | Уведомление/warning |

---

### Новые Tools для Brain Agent

**Файлы:** `agents/ads/toolDefs.js`, `agents/ads/handlers.js`

#### getAgentBrainActions

Получить историю действий Brain Agent:

```javascript
// Tool Definition
getAgentBrainActions: {
  description: 'Получить историю действий Brain Agent за период',
  schema: z.object({
    period: z.enum(['last_1d', 'last_3d', 'last_7d']).default('last_3d'),
    limit: z.number().min(1).max(50).default(20),
    action_type: z.enum(['all', 'budget_change', 'pause', 'resume', 'launch']).default('all')
  }),
  meta: { timeout: 15000, retryable: true }
}

// Response
{
  success: true,
  actions: [
    {
      id: 'uuid',
      type: 'budget_change',
      target: { type: 'adset', id: '123', name: 'Test AdSet' },
      details: { old_budget: 1000, new_budget: 1500, change_pct: 50 },
      reason: 'Good CPL performance',
      timestamp: '2024-01-15T10:00:00Z'
    }
  ],
  summary: {
    total: 15,
    by_type: { budget_change: 8, pause: 4, resume: 2, launch: 1 }
  }
}
```

#### triggerBrainOptimizationRun

Запустить принудительный цикл оптимизации:

```javascript
// Tool Definition
triggerBrainOptimizationRun: {
  description: 'Запустить цикл Brain Agent оптимизации. ОПАСНАЯ ОПЕРАЦИЯ.',
  schema: z.object({
    direction_id: uuidSchema.optional(),
    dry_run: z.boolean().optional(),
    reason: z.string().optional()
  }),
  meta: { timeout: 120000, retryable: false, dangerous: true }
}

// Response (dry_run: true)
{
  success: true,
  dry_run: true,
  would_execute: [
    { type: 'budget_change', target: 'AdSet #123', change: '+20%' },
    { type: 'pause', target: 'AdSet #456', reason: 'High CPL' }
  ],
  message: 'Preview: 2 действия будут выполнены'
}

// Response (dry_run: false)
{
  success: true,
  execution_id: 'uuid',
  status: 'running',
  message: 'Brain Agent запущен, результаты через 1-2 минуты'
}
```

---

### Миграция: Tier State Persistence

**Файл:** `migrations/100_add_tier_state.sql`

```sql
-- Tier State для Playbook Registry
ALTER TABLE ai_conversations
ADD COLUMN IF NOT EXISTS tier_state JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS tier_expires_at TIMESTAMPTZ DEFAULT NULL;

-- Index для активных tier states
CREATE INDEX IF NOT EXISTS idx_ai_conversations_tier_active
ON ai_conversations(tier_expires_at)
WHERE tier_state IS NOT NULL;

-- Comment
COMMENT ON COLUMN ai_conversations.tier_state IS 'Tier-based playbook state: currentTier, snapshotData, transitions';
```

**UnifiedStore методы:**

| Метод | Описание |
|-------|----------|
| `getTierState(conversationId)` | Получить tier state с проверкой TTL |
| `setTierState(conversationId, state)` | Сохранить с TTL 1 час |
| `clearTierState(conversationId)` | Очистить после завершения |

---

### Conditional Clarifying Questions

Расширение ClarifyingGate для условных вопросов:

```javascript
// askIf conditions
clarifyingQuestions: [
  {
    field: 'period',
    type: 'period',
    default: 'last_3d',
    askIf: 'period_not_in_message'  // Спрашивать только если не извлечено из сообщения
  },
  {
    field: 'direction',
    type: 'entity',
    askIf: 'directions_count > 1'   // Спрашивать только если >1 направление
  },
  {
    field: 'symptom',
    type: 'choice',
    options: [
      { value: 'no_spend', label: 'Нет расхода' },
      { value: 'spend_no_leads', label: 'Расход есть, лидов нет' }
    ],
    alwaysAskIf: 'user_message_is_vague'  // Всегда спрашивать если сообщение размытое
  }
]
```

**Vague Message Detection:**
- Длина < 25 символов
- Нет period слов (сегодня, вчера, неделя)
- Нет entity refs ([d1], кампания, направление)
- Общие фразы: "не работает", "дорого", "плохо"

---

### Tier Flow в Orchestrator

```javascript
// orchestrator/index.js

async processHybridRequest({ message, context, tierState, ... }) {
  // 1. Load or create tier state
  const currentTierState = tierState ||
    await unifiedStore.getTierState(conversationId) ||
    tierManager.createInitialState(policy.playbookId);

  // 2. Handle pending next step (user clicked button)
  if (currentTierState.pendingNextStep) {
    const { targetTier } = currentTierState.pendingNextStep;
    currentTierState = tierManager.transitionTo(currentTierState, targetTier, {
      reason: 'user_choice'
    });
  }

  // 3. Get tools for current tier
  const tierPolicy = playbookRegistry.getTierPolicy(
    currentTierState.playbookId,
    currentTierState.currentTier
  );

  // 4. Execute with tier-limited tools
  const response = await this.executeWithTier(message, tierPolicy, context);

  // 5. Evaluate enter conditions for auto-transition
  if (currentTierState.currentTier === 'snapshot') {
    const conditions = tierManager.evaluateEnterConditions(
      currentTierState.playbookId,
      response.data,
      context
    );
    currentTierState.evaluatedConditions = conditions;
  }

  // 6. Save tier state
  await unifiedStore.setTierState(conversationId, currentTierState);

  // 7. Assemble response with next steps
  return responseAssembler.assembleTierResponse(response, {
    tierState: currentTierState,
    playbook: playbookRegistry.getPlaybook(currentTierState.playbookId)
  });
}
```

---

### Configuration

```bash
# Environment Variables

# Enable Tier State (default: true)
TIER_STATE_ENABLED=true

# Tier State TTL in ms (default: 1 hour)
TIER_STATE_TTL=3600000
```

```javascript
// hybrid/index.js

export const HYBRID_CONFIG = {
  enabled: process.env.HYBRID_ENABLED === 'true',
  clarifyingGateEnabled: process.env.CLARIFYING_GATE_ENABLED !== 'false',
  maxToolCalls: parseInt(process.env.HYBRID_MAX_TOOL_CALLS || '5', 10),
  defaultDangerousPolicy: 'block',
  tierStateEnabled: process.env.TIER_STATE_ENABLED !== 'false',
  tierStateTTL: parseInt(process.env.TIER_STATE_TTL || '3600000', 10)
};
```

---

### Module Exports (Updated)

```javascript
// hybrid/index.js

// Phase 1: Policy Engine + Tool Filter
export { PolicyEngine, policyEngine } from './policyEngine.js';
export {
  filterToolsForOpenAI,
  validateToolCall,
  isDangerousTool,
  getToolType,
  getToolsSummary,
  filterReadOnlyTools,
  policyToSessionExtensions
} from './toolFilter.js';

// Phase 2: Clarifying Gate
export {
  ClarifyingGate,
  clarifyingGate,
  QUESTION_TYPES,
  EXTRACTION_PATTERNS,
  isVagueMessage,
  hasPeriodInMessage,
  hasMetricInMessage
} from './clarifyingGate.js';

// Phase 3: Response Assembler
export {
  ResponseAssembler,
  responseAssembler,
  SECTION_TYPES,
  NEXT_STEP_RULES
} from './responseAssembler.js';

// Phase 4: Playbook Registry + Tier Manager
export {
  PlaybookRegistry,
  playbookRegistry,
  PLAYBOOKS
} from './playbookRegistry.js';

export {
  TierManager,
  tierManager,
  TIERS
} from './tierManager.js';

export {
  evaluateExpression,
  evaluateCondition,
  PRESET_CONDITIONS
} from './expressionEvaluator.js';

// Phase 5: UI Components for Web
export {
  createActionsComponent,
  createChoiceComponent,
  createApprovalComponent,
  createProgressComponent,
  createTableComponent,
  createCardsComponent,
  createMetricComponent,
  createMetricsRowComponent,
  createAlertComponent,
  assembleUiJson,
  createPlaybookNextSteps
} from './uiComponents.js';

// Config
export { HYBRID_CONFIG };
```

---

### Файловая структура (обновлённая)

```
chatAssistant/hybrid/
├── index.js                # Экспорты + HYBRID_CONFIG
├── policyEngine.js         # Intent detection + policy resolution
├── toolFilter.js           # Фильтрация tools для OpenAI
├── clarifyingGate.js       # Уточняющие вопросы (+ askIf, vague detection)
├── responseAssembler.js    # Сборка финального ответа (+ tier UI)
├── playbookRegistry.js     # 10 playbooks + PlaybookRegistry class
├── tierManager.js          # TierManager class для переходов
├── expressionEvaluator.js  # Безопасный eval для условий
└── uiComponents.js         # UI components для Web
```
