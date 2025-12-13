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

**15 инструментов:**

| Tool | Тип | Описание |
|------|-----|----------|
| `getCampaigns` | READ | Список кампаний с метриками |
| `getCampaignDetails` | READ | Детали кампании + адсеты + объявления |
| `getAdSets` | READ | Адсеты кампании с метриками |
| `getSpendReport` | READ | Отчёт по расходам (группировка по дням/кампаниям) |
| `getDirections` | READ | Направления с агрегированными метриками |
| `getDirectionDetails` | READ | Детали направления + креативы + FB адсет |
| `getDirectionMetrics` | READ | Метрики направления по дням |
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

Работа с лидами, воронкой продаж, квалификацией.

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
| "Покажи все креативы" | CreativeAgent | getCreatives |
| "Топ креативы по CPL" | CreativeAgent | getTopCreatives |
| "Проанализируй креатив" | CreativeAgent | triggerCreativeAnalysis |
| "Запусти креатив в направление" | CreativeAgent | launchCreative |
| "Сравни эти 3 креатива" | CreativeAgent | compareCreatives |
| "Покажи retention видео" | CreativeAgent | getCreativeMetrics |
| "Последние диалоги" | WhatsAppAgent | getDialogs |
| "Лиды за сегодня" | CRMAgent | getLeads |

---

## Ключевые метрики

### Реклама
- **Spend** — потраченный бюджет ($)
- **Leads** — количество заявок
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
- `directions` — направления (рекламные вертикали)

### Creatives
- `user_creatives` — креативы пользователя
- `creative_analysis` — LLM-анализы креативов
- `creative_scores` — risk scores
- `creative_tests` — A/B тесты
- `creative_metrics_history` — исторические метрики
- `ad_creative_mapping` — связь объявлений и креативов

### Metrics
- `direction_metrics_daily` — метрики направлений по дням
- `adset_metrics_history` — метрики адсетов

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
Telegram Message
       │
       ▼
┌──────────────────┐
│ TelegramHandler  │  ← handleTelegramMessage()
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ConversationStore │  ← Persistence в Supabase
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
         ▼
┌──────────────────┐
│TelegramStreamer  │  ← Debounced message updates (500ms)
└──────────────────┘
```

### ConversationStore

**Путь:** `services/agent-brain/src/chatAssistant/persistence/conversationStore.js`

**Методы:**
| Метод | Описание |
|-------|----------|
| `getOrCreateConversation(telegramChatId, userId, adAccountId)` | Получить или создать диалог |
| `loadMessages(conversationId, limit)` | Загрузить последние N сообщений |
| `addMessage(conversationId, message)` | Добавить сообщение |
| `acquireLock(conversationId)` | Захватить mutex (concurrency) |
| `releaseLock(conversationId)` | Освободить mutex |
| `clearMessages(conversationId)` | Очистить историю |
| `setMode(conversationId, mode)` | Изменить режим (auto/plan/ask) |
| `updateRollingSummary(conversationId, summary)` | Обновить саммари |

### Таблицы Persistence

```sql
-- Шапка диалога
chat_conversations (
  id, user_account_id, ad_account_id,
  source,           -- 'telegram' | 'web'
  telegram_chat_id,
  mode,             -- 'auto' | 'plan' | 'ask'
  is_processing,    -- mutex для concurrency
  rolling_summary,  -- саммари старых сообщений
  last_agent, last_domain
)

-- Отдельные сообщения
chat_messages (
  id, conversation_id,
  role,             -- 'user' | 'assistant' | 'system' | 'tool'
  content,
  tool_calls,       -- JSONB [{name, arguments, id}]
  tool_call_id, tool_name, tool_result,
  agent, tokens_used
)

-- Ожидающие подтверждения
chat_pending_actions (
  id, conversation_id,
  tool_name, tool_args, agent,
  status            -- 'pending' | 'approved' | 'rejected' | 'expired'
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

### Telegram API Endpoints

```
POST /api/brain/telegram/chat
  body: { telegramChatId, message }
  → Обработать сообщение (non-streaming)

POST /api/brain/telegram/clear
  body: { telegramChatId }
  → Очистить историю

POST /api/brain/telegram/mode
  body: { telegramChatId, mode }
  → Изменить режим

GET /api/brain/telegram/status?telegramChatId=...
  → Получить статус диалога
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
