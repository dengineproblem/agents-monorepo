# NanoClaw Telegram Bot — ARCHITECTURE

Полная техническая документация по telegram-claude-bot (NanoClaw).

---

## 1. Обзор системы

**Назначение:** Telegram-бот для управления рекламными кампаниями (Facebook/TikTok), креативами, CRM и онбордингом пользователей.

**Стек:**
- **Runtime:** Node.js 20+ (TypeScript)
- **AI:** Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) с native Tool Use API
- **Telegram:** `node-telegram-bot-api` (long polling)
- **Backend tools:** agent-brain (Fastify, порт 7080)
- **БД:** SQLite (better-sqlite3) — локальная история сообщений
- **User resolution:** Supabase REST API (telegram_id -> userAccountId)
- **Голос:** OpenAI Whisper API (`whisper-1`)
- **Логирование:** Pino + pino-pretty

**Архитектура:** Однотурновая — каждое Telegram-сообщение обрабатывается как отдельный запрос к Claude с собственным Tool Use циклом (до 10 turns внутри). Между сообщениями conversation context НЕ сохраняется.

---

## 2. Диаграмма архитектуры

```
                        TELEGRAM USER
                             |
                    текст / голос / фото
                             |
                             v
┌──────────────────────────────────────────────────────────────┐
│              TELEGRAM-CLAUDE-BOT (polling)                    │
│                                                                │
│  1. Parse message (text / voice->Whisper / photo->URL)        │
│  2. Store in SQLite                                            │
│  3. Check trigger (/bot, @Claude, private chat)               │
│  4. Resolve telegram_id -> userAccountId (Supabase REST)      │
│  5. Load system prompt (groups/main/CLAUDE.md)                │
│  6. Inject userAccountId into prompt                          │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │          TOOL USE LOOP (max 10 turns)                    │ │
│  │                                                            │ │
│  │  anthropic.messages.create({                              │ │
│  │    model: 'claude-haiku-4-5-20251001',                   │ │
│  │    system: systemPrompt,                                  │ │
│  │    tools: [49 tools + web_search],                         │ │
│  │    messages: [...]                                        │ │
│  │  })                                                        │ │
│  │       |                                                    │ │
│  │       v                                                    │ │
│  │  stop_reason === 'tool_use'?                              │ │
│  │    YES -> executeTool() -> POST agent-brain -> result     │ │
│  │           -> add to messages -> continue loop             │ │
│  │    (server_tool_use = web search, handled server-side)    │ │
│  │  stop_reason === 'pause_turn'? -> continue loop           │ │
│  │    NO  -> extract text + citations -> send to Telegram    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  7. Send response (Markdown, fallback plain text)             │
│  8. Store response in SQLite                                   │
└──────────────────────────────────────────────────────────────┘
                             |
                    POST /brain/tools/{name}
                             |
                             v
┌──────────────────────────────────────────────────────────────┐
│              AGENT-BRAIN (Fastify, port 7080)                 │
│                                                                │
│  getToolByName(toolName) -> tool.handler(args, context)       │
│  context = { userAccountId, accessToken, adAccountId, ... }   │
│                                                                │
│  6 категорий: ads | creative | crm | tiktok | whatsapp | sys │
│  90 tools total (бот использует подмножество — 49)           │
└──────────────────────────────────────────────────────────────┘
                             |
                             v
┌──────────────────────────────────────────────────────────────┐
│                    SUPABASE (PostgreSQL)                       │
│                                                                │
│  user_accounts, ad_accounts, leads, user_creatives,           │
│  error_logs, directions, campaigns, ...                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Структура проекта

```
services/telegram-claude-bot/
├── src/
│   ├── index.ts              # Точка входа: polling, handleMessage, Tool Use цикл
│   ├── config.ts             # ENV переменные, пути, TRIGGER_PATTERN, таймзона
│   ├── tools.ts              # 49 Anthropic Tool определений + executeTool()
│   ├── db.ts                 # SQLite: init, CRUD для chats/messages/tasks
│   ├── types.ts              # TypeScript интерфейсы
│   ├── logger.ts             # Pino logger (info/warn/error/debug)
│   ├── utils.ts              # loadJson(), saveJson()
│   ├── task-scheduler.ts     # Cron/interval планировщик [ОТКЛЮЧЁН]
│   ├── container-runner.ts   # Docker контейнеры [НЕ ИСПОЛЬЗУЕТСЯ]
│   └── mount-security.ts    # Mount валидация [НЕ ИСПОЛЬЗУЕТСЯ]
├── groups/
│   └── main/
│       └── CLAUDE.md         # Системный промпт для Claude (267 строк)
├── store/
│   └── messages.db           # SQLite БД (история сообщений)
├── data/
│   ├── router_state.json     # Состояние маршрутизатора
│   └── sessions.json         # Сессии по группам
├── Dockerfile
├── .env                      # Секреты (не в git)
├── .env.example              # Шаблон .env
├── package.json
└── tsconfig.json
```

### Описание файлов

| Файл | Строк | Описание |
|------|-------|----------|
| `index.ts` | ~454 | Главная логика: Telegram polling, handleMessage(), Tool Use цикл, Whisper транскрибация, Supabase резолв |
| `config.ts` | 58 | Все ENV переменные, пути к директориям, regex триггер `/bot\|@Claude`, таймзона |
| `tools.ts` | ~988 | Определения 49 custom tools (JSON Schema для Anthropic API) + функция executeTool() для HTTP вызова agent-brain + таймауты. Web search tool определён отдельно в index.ts |
| `db.ts` | ~322 | SQLite инициализация, таблицы chats/messages/scheduled_tasks/task_run_logs, CRUD операции |
| `types.ts` | 80 | Интерфейсы: Session, NewMessage, ScheduledTask, MountAllowlist, ContainerConfig |
| `logger.ts` | 6 | Конфигурация Pino: уровень из `LOG_LEVEL` env, pino-pretty транспорт |
| `utils.ts` | 19 | Хелперы: `loadJson(path, default)`, `saveJson(path, data)` |
| `task-scheduler.ts` | 172 | Планировщик задач: cron/interval/once, getDueTasks(), runTask() — **отключён** |
| `container-runner.ts` | ~490 | Запуск Docker контейнеров — **не используется в Telegram боте** |
| `mount-security.ts` | ~285 | Валидация mount points — **не используется в Telegram боте** |

---

## 4. Flow обработки сообщения

Функция `handleMessage()` в `src/index.ts` — основной обработчик каждого входящего Telegram-сообщения.

### Шаг 1: Получение сообщения

```
bot.on('message', handleMessage)
```

Бот использует **long polling** (`{ polling: true }`) — нет webhook, нет внешнего IP.

### Шаг 2: Определение типа сообщения

| Тип | Обработка |
|-----|-----------|
| **Текст** | `msg.text` — используется напрямую |
| **Голос / Видеосообщение** | `msg.voice` или `msg.video_note` → `transcribeVoice(file_id)` → OpenAI Whisper → текст |
| **Фото** | `msg.photo[last]` → `getFileLink(file_id)` → URL инжектируется в текст: `[Пользователь приложил референс-изображение: URL]` |
| **Подпись к фото** | `msg.caption` — объединяется с URL фото |

### Шаг 3: Сохранение в SQLite

```typescript
storeChatMetadata(chatId, chatName);
storeMessage({
  id: messageId,
  chat_id: chatId,
  sender: senderName,
  text: messageText,
  timestamp: new Date().toISOString(),
  is_from_me: false,
});
```

### Шаг 4: Проверка триггера

| Тип чата | Условие ответа |
|----------|---------------|
| **Личный (private)** | Всегда отвечает |
| **Групповой** | Только если сообщение начинается с `/bot` или `@Claude` (case-insensitive) |

Regex триггера из `config.ts`:
```typescript
export const TRIGGER_PATTERN = new RegExp(
  `^(/bot|@${escapeRegex(ASSISTANT_NAME)})\\b`, 'i'
);
```

### Шаг 5: Резолв telegram_id -> userAccountId

```typescript
const userAccountId = await resolveUserAccountId(telegramId);
```

**Механизм:**
1. Проверяет in-memory кэш (`Map<number, string>`)
2. Если нет — HTTP GET к Supabase REST API:
   ```
   GET {SUPABASE_URL}/rest/v1/user_accounts?telegram_id=eq.{telegramId}&select=id
   Headers: apikey + Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}
   ```
3. Результат кэшируется в памяти (до перезапуска бота)
4. Если пользователь не найден — бот отвечает "Ваш Telegram аккаунт не привязан к системе"

### Шаг 6: Загрузка системного промпта

```typescript
const baseSystemPrompt = fs.readFileSync(
  path.join(DATA_DIR, '..', 'groups', 'main', 'CLAUDE.md'), 'utf-8'
);
const systemPrompt = `userAccountId пользователя: ${userAccountId}\n\n` +
  `Всегда используй этот userAccountId при вызове tools.\n\n${baseSystemPrompt}`;
```

Файл `groups/main/CLAUDE.md` читается при **каждом сообщении** (не кэшируется). Это значит, что изменения в CLAUDE.md применяются без перезапуска бота.

### Шаг 7: Tool Use Loop

```typescript
const messages: Anthropic.MessageParam[] = [{ role: 'user', content: cleanedMessage }];
let continueLoop = true;
let turnCount = 0;
const MAX_TURNS = 10;

while (continueLoop && turnCount < MAX_TURNS) {
  turnCount++;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: systemPrompt,
    tools,
    messages,
  });

  messages.push({ role: 'assistant', content: response.content });

  if (response.stop_reason === 'tool_use') {
    // Выполнить каждый tool и добавить результаты
    const toolResults = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const toolInput = { ...block.input, userAccountId };  // ИНЖЕКТ userAccountId
        const result = await executeTool(block.name, toolInput);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
    continue;  // Следующий turn
  }

  if (response.stop_reason === 'end_turn') {
    // Собрать текстовый ответ
    for (const block of response.content) {
      if (block.type === 'text') agentResponse += block.text;
    }
    continueLoop = false;
  }
}
```

**Ключевые моменты:**
- `MAX_TURNS = 10` — защита от бесконечного цикла
- `userAccountId` инжектируется в **каждый** tool input автоматически
- Claude может вызвать несколько tools за один turn (parallel tool use)
- Между Telegram-сообщениями conversation history **не сохраняется**
- **Web Search** обрабатывается server-side: блоки `server_tool_use` и `web_search_tool_result` уже включены в `response.content`, для них НЕ нужно отправлять `tool_result`
- При `stop_reason === 'pause_turn'` (долгий web search) — продолжаем loop
- Citations из web search результатов собираются и добавляются в конец ответа как блок "Источники:"

### Шаг 8: Отправка ответа

```typescript
try {
  await bot.sendMessage(chatId, agentResponse, { parse_mode: 'Markdown' });
} catch (err) {
  // Fallback: отправить без форматирования
  await bot.sendMessage(chatId, agentResponse);
}
```

Telegram Markdown может упасть на невалидном форматировании — поэтому есть fallback без `parse_mode`.

### Шаг 9: Сохранение ответа

```typescript
storeMessage({
  id: `${messageId}-response`,
  chat_id: chatId,
  sender: ASSISTANT_NAME,
  text: agentResponse,
  timestamp: new Date().toISOString(),
  is_from_me: true,
});
saveState();
```

---

## 5. Tool Use — полный цикл

### 5.1 Как Claude вызывает tools

Claude Haiku 4.5 получает массив `tools` (49 определений) в каждом запросе. Когда Claude решает вызвать tool, он возвращает `stop_reason: 'tool_use'` и один или несколько блоков:

```json
{
  "type": "tool_use",
  "id": "toolu_xxx",
  "name": "getCampaigns",
  "input": { "period": "last_7d" }
}
```

### 5.2 Инжект userAccountId

Claude НЕ знает реальный userAccountId — он указан только в system prompt. Бот автоматически добавляет его в каждый tool input:

```typescript
const toolInput = { ...(block.input as Record<string, any>), userAccountId };
```

Это гарантирует, что handler в agent-brain всегда получает корректный userAccountId, даже если Claude его не передал.

### 5.3 Вызов agent-brain

```typescript
export async function executeTool(toolName: string, toolInput: Record<string, any>) {
  const url = `${BRAIN_SERVICE_URL}/brain/tools/${toolName}`;
  const timeout = getToolTimeout(toolName);
  const response = await axios.post(url, toolInput, { timeout });
  return response.data;
}
```

### 5.4 Таймауты

```typescript
const TOOL_TIMEOUTS: Record<string, number> = {
  // Генерация изображений — до 3 минут
  generateCreatives: 180_000,
  createImageCreative: 180_000,

  // Карусель — до 10 минут (несколько изображений)
  generateCarousel: 600_000,

  // Текстовая генерация — до 3 минут
  generateOffer: 180_000,
  generateBullets: 180_000,
  generateProfits: 180_000,
  generateCta: 180_000,
  generateTextCreative: 180_000,
  generateCarouselTexts: 180_000,

  // AI-анализ — до 2 минут
  triggerCreativeAnalysis: 120_000,
  analyzeDialog: 120_000,
  triggerBrainOptimizationRun: 120_000,
};
const DEFAULT_TIMEOUT = 30_000; // 30 секунд для всех остальных
```

**Правило:** Если tool делает LLM-вызов или генерацию изображений — ставь увеличенный таймаут. Иначе хватает 30s.

### 5.5 Обработка ошибок

При ошибке HTTP-запроса `executeTool()` возвращает:
```json
{ "success": false, "error": "Error message" }
```
Этот результат передаётся обратно в Claude как `tool_result` — Claude сам объясняет пользователю, что произошла ошибка.

---

## 6. Интеграция с agent-brain

### 6.1 HTTP эндпоинт

**Файл:** `services/agent-brain/src/mcp/server.js`
**Эндпоинт:** `POST /brain/tools/:toolName`

```
Body: { userAccountId, accountId?, ...toolArgs }
Response (success): { success: true, data: {...} }
Response (error): { success: false, error: "message" }
Response (404): { success: false, error: "tool_not_found" }
Response (timeout): { success: false, error: "timeout" }
```

### 6.2 Регистрация tools

**Файл:** `services/agent-brain/src/mcp/tools/definitions.js`

```javascript
function createMCPTool(name, toolDef, handler, agent) {
  return {
    name,                                    // Имя tool
    description: toolDef.description,        // Описание
    inputSchema: zodToMCPSchema(toolDef.schema), // JSON Schema из Zod
    zodSchema: toolDef.schema,               // Оригинальная Zod-схема
    handler,                                 // async function(args, context)
    agent,                                   // Категория: 'ads', 'creative', ...
    meta: toolDef.meta || {}                 // { timeout, retryable, dangerous }
  };
}
```

### 6.3 Маршрутизация

```javascript
export const allMCPTools = [
  ...whatsappTools,    // 4 tools
  ...crmTools,         // 13 tools
  ...creativeTools,    // 23 tools
  ...adsTools,         // 24 tools
  ...tikTokAdsTools,  // 25 tools
  ...systemTools       // 1 tool
];  // ИТОГО: ~90 tools

export function getToolByName(name) {
  return allMCPTools.find(t => t.name === name);
}
```

### 6.4 Контекст выполнения

Когда запрос приходит в agent-brain, происходит:

1. **Валидация имени:** regex `/^[a-zA-Z][a-zA-Z0-9_]*$/`
2. **Поиск tool:** `getToolByName(toolName)`
3. **Получение credentials:** `getCredentials(userAccountId, accountId)` — запрос к Supabase за access_token, ad_account_id
4. **Формирование context:**
   ```javascript
   {
     userAccountId,     // UUID пользователя
     accessToken,       // Facebook/TikTok API token
     adAccountId,       // act_xxx (Facebook Ad Account ID)
     accountId,         // UUID из ad_accounts (multi-account mode)
     isMultiAccountMode // boolean
   }
   ```
5. **Выполнение:** `tool.handler(toolArgs, context)`

### 6.5 Категории агентов в agent-brain

| Категория | Путь | Tools | Описание |
|-----------|------|-------|----------|
| `ads` | `agents/ads/` | 24 | Facebook Ads: кампании, адсеты, бюджеты, directions |
| `creative` | `agents/creative/` | 23 | Креативы: генерация, анализ, A/B тесты, скоринг |
| `crm` | `agents/crm/` | 13 | CRM: лиды, продажи, воронка, amoCRM интеграция |
| `tiktok` | `agents/tiktok/` | 25 | TikTok Ads: кампании, адгруппы, видео, ROI |
| `whatsapp` | `agents/whatsapp/` | 4 | WhatsApp: диалоги, поиск, AI-анализ |
| `system` | `agents/system/` | 1 | Системные: ошибки пользователя |

Каждая категория — это папка с двумя файлами:
- `toolDefs.js` — Zod-схемы и описания
- `handlers.js` — async функции-обработчики (Supabase / Facebook API / AI)

---

## 7. Список всех tools в боте

### Facebook Ads — READ (13 tools)

| Tool | Описание | Таймаут |
|------|----------|---------|
| `getCampaigns` | Список кампаний с метриками | 30s |
| `getAdSets` | Адсеты кампании | 30s |
| `getCampaignDetails` | Детали кампании | 30s |
| `getAds` | Объявления адсета | 30s |
| `getSpendReport` | Отчёт по расходам (breakdown: day/week/campaign/adset) | 30s |
| `getDirections` | Направления (группы кампаний) | 30s |
| `getDirectionMetrics` | Метрики направления | 30s |
| `getROIReport` | ROI отчёт по креативам | 30s |
| `getROIComparison` | Сравнение ROI | 30s |
| `getAdAccountStatus` | Статус рекламного аккаунта | 30s |
| `getLeadsEngagementRate` | Качество лидов WhatsApp (QCPL) | 30s |
| `getAgentBrainActions` | История действий оптимизатора | 30s |
| `triggerBrainOptimizationRun` | Запуск Brain Mini оптимизации | 120s |

### Facebook Ads — WRITE (10 tools)

| Tool | Описание | Dangerous |
|------|----------|-----------|
| `pauseAdSet` / `resumeAdSet` | Пауза/возобновление адсета | Yes |
| `updateBudget` | Изменить бюджет адсета (в долларах) | Yes |
| `scaleBudget` | Масштабировать бюджет на % | Yes |
| `pauseAd` / `resumeAd` | Пауза/возобновление объявления | Yes |
| `updateDirectionBudget` | Изменить бюджет направления | Yes |
| `updateDirectionTargetCPL` | Изменить целевой CPL | Yes |
| `pauseDirection` / `resumeDirection` | Пауза/возобновление направления | Yes |
| `approveBrainActions` | Выполнить рекомендации Brain Mini | Yes |
| `createDirection` | Создать новое направление | No |

### Creatives — READ (10 tools)

| Tool | Описание |
|------|----------|
| `getCreatives` | Список креативов (фильтр по direction, статус, сортировка) |
| `getCreativeDetails` | Полная информация о креативе |
| `getCreativeMetrics` | Метрики по дням + video retention |
| `getTopCreatives` | Лучшие по CPL/leads/CTR/score |
| `getWorstCreatives` | Худшие по CPL |
| `compareCreatives` | Сравнение 2-5 креативов |
| `getCreativeAnalysis` | AI-анализ (score, verdict) |
| `getCreativeScores` | Risk scores и predictions |
| `getCreativeTests` | История A/B тестов |
| `getCreativeTranscript` | Транскрипция видео |

### Creatives — WRITE (9 tools)

| Tool | Описание | Таймаут |
|------|----------|---------|
| `generateOffer` | ШАГ 1: заголовок/оффер | 180s |
| `generateBullets` | ШАГ 2: буллеты | 180s |
| `generateProfits` | ШАГ 3: выгоды | 180s |
| `generateCta` | ШАГ 4: CTA | 180s |
| `generateCreatives` | ШАГ 5: изображение 1080x1920 | 180s |
| `generateCarouselTexts` | Тексты для карусели | 180s |
| `generateCarousel` | Изображения карусели | 600s |
| `generateTextCreative` | Текст для видео/постов | 180s |
| `createImageCreative` | Загрузить в Facebook | 180s |

Дополнительные WRITE tools для управления:

| Tool | Описание |
|------|----------|
| `pauseCreative` | Пауза всех объявлений креатива |
| `launchCreative` | Запустить креатив в направление |
| `startCreativeTest` / `stopCreativeTest` | A/B тест (~$20) |
| `triggerCreativeAnalysis` | Запустить AI-анализ |

### CRM (8 tools)

| Tool | Тип | Описание |
|------|-----|----------|
| `getLeads` | READ | Список лидов с фильтрацией |
| `getSales` | READ | Продажи за период |
| `getFunnelStats` | READ | Статистика воронки |
| `getDialogs` | READ | WhatsApp диалоги |
| `analyzeDialog` | READ | AI-анализ диалога (120s) |
| `getSalesQuality` | READ | KPI ladder |
| `addSale` | WRITE | Добавить продажу (тенге) |
| `updateLeadStage` | WRITE | Изменить стадию лида |

### TikTok (3 tools в боте)

| Tool | Описание |
|------|----------|
| `getTikTokCampaigns` | Список TikTok кампаний |
| `compareTikTokWithFacebook` | Сравнение платформ |
| `pauseTikTokCampaign` | Пауза TikTok кампании |

> **Примечание:** В agent-brain 25 TikTok tools, но в бот подключено только 3. Остальные можно добавить по мере необходимости.

### Onboarding (1 tool)

| Tool | Описание |
|------|----------|
| `createUser` | Создать пользователя (business_name, niche, username, password) |

### System (1 tool)

| Tool | Описание |
|------|----------|
| `getUserErrors` | Ошибки пользователя с LLM-расшифровкой (severity, type, explanation, solution) |

### Web Search (встроенный, server-side)

| Tool | Описание |
|------|----------|
| `web_search` | Поиск бизнес-информации в интернете (Anthropic server-side, не через agent-brain) |

**Особенности:**
- Использует встроенный Anthropic Web Search Tool (`type: web_search_20250305`)
- Обрабатывается server-side — НЕ проходит через agent-brain
- Claude сам решает когда нужен поиск на основе промпта
- Ограничение: `max_uses: 5` поисков за один запрос
- Локализация: `user_location: { country: 'KZ', timezone: 'Asia/Almaty' }`
- Стоимость: $10 за 1,000 поисков (плюс стандартные токены)
- **Только для бизнес-вопросов** (конкуренты, тренды, исследование ниши) — НЕ для общих вопросов

---

## 8. Конфигурация

### 8.1 Переменные окружения (.env)

| Переменная | Обязательная | Описание |
|------------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Да | Токен Telegram бота от @BotFather |
| `ANTHROPIC_API_KEY` | Да | API ключ Anthropic для Claude |
| `OPENAI_API_KEY` | Нет | API ключ OpenAI для Whisper (голосовые сообщения) |
| `BRAIN_SERVICE_URL` | Да | URL agent-brain (по умолчанию `http://agent-brain:7080`) |
| `SUPABASE_URL` | Да | URL проекта Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Да | Service Role Key для Supabase |
| `ASSISTANT_NAME` | Нет | Имя бота (по умолчанию `Claude`) |
| `TZ` | Нет | Часовой пояс (по умолчанию системный) |
| `LOG_LEVEL` | Нет | Уровень логирования: debug/info/warn/error |

### 8.2 Константы (config.ts)

| Константа | Значение | Описание |
|-----------|---------|----------|
| `POLL_INTERVAL` | 2000 ms | Интервал polling Telegram |
| `SCHEDULER_POLL_INTERVAL` | 60000 ms | Интервал планировщика (не используется) |
| `TRIGGER_PATTERN` | `/^(/bot\|@Claude)\b/i` | Regex триггера для групп |
| `STORE_DIR` | `{cwd}/store` | Путь к SQLite БД |
| `GROUPS_DIR` | `{cwd}/groups` | Путь к системному промпту |
| `DATA_DIR` | `{cwd}/data` | Путь к JSON состоянию |

---

## 9. База данных (SQLite)

**Путь:** `store/messages.db`
**Библиотека:** `better-sqlite3`

### Схема

```sql
-- Чаты
CREATE TABLE chats (
  chat_id TEXT PRIMARY KEY,
  name TEXT,
  last_message_time TEXT
);

-- Сообщения
CREATE TABLE messages (
  id TEXT,
  chat_id TEXT,
  sender TEXT,
  text TEXT,
  timestamp TEXT,
  is_from_me INTEGER,          -- 0 = от пользователя, 1 = от бота
  PRIMARY KEY (id, chat_id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);
CREATE INDEX idx_timestamp ON messages(timestamp);

-- Планировщик задач (не используется)
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  group_folder TEXT,
  chat_id TEXT,
  prompt TEXT,
  schedule_type TEXT,          -- 'cron' | 'interval' | 'once'
  schedule_value TEXT,
  next_run TEXT,
  last_run TEXT,
  last_result TEXT,
  status TEXT,                 -- 'active' | 'paused' | 'completed'
  created_at TEXT
);
CREATE INDEX idx_next_run ON scheduled_tasks(next_run);

-- Логи задач (не используется)
CREATE TABLE task_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  run_at TEXT,
  duration_ms INTEGER,
  status TEXT,                 -- 'success' | 'error'
  result TEXT,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
);
```

### Использование

- **Входящее сообщение** → `storeMessage()` с `is_from_me: false`
- **Ответ бота** → `storeMessage()` с `is_from_me: true`, id = `{messageId}-response`
- **Метаданные чата** → `storeChatMetadata(chatId, chatName)`

**Важно:** SQLite хранит только историю сообщений. Conversation context для Claude строится в памяти за каждый запрос и **не сохраняется** между Telegram-сообщениями.

---

## 10. Системный промпт (CLAUDE.md)

**Путь:** `groups/main/CLAUDE.md`

### Содержание

1. **Роли:** 5 специалистов (Facebook Ads, Creatives, CRM, TikTok, Onboarding)
2. **Безопасность:** Запрет раскрытия API ключей, env, путей
3. **Форматирование:** Telegram Markdown, мобильный формат, эмодзи статусов
4. **Tools:** Полный список с описаниями (50+ tools)
5. **Правила работы:** 11 правил — бюджеты, лиды, 3 типа креативов, Brain Mini, ошибки

### Как загружается

```typescript
const baseSystemPrompt = fs.readFileSync(
  path.join(DATA_DIR, '..', 'groups', 'main', 'CLAUDE.md'), 'utf-8'
);
const systemPrompt = `userAccountId пользователя: ${userAccountId}\n\n` +
  `Всегда используй этот userAccountId при вызове tools.\n\n${baseSystemPrompt}`;
```

**Загружается при каждом сообщении** — изменения в CLAUDE.md вступают в силу сразу, без перезапуска бота.

### Как редактировать

1. Открыть `groups/main/CLAUDE.md`
2. Внести изменения
3. Следующее сообщение в Telegram подхватит обновлённый промпт
4. Для production — нужен rebuild Docker image или volume mount

---

## 11. Голосовые сообщения (Whisper)

### Flow

```
msg.voice / msg.video_note
    ↓
bot.getFileLink(file_id) → URL
    ↓
axios.get(URL, { responseType: 'arraybuffer' }) → Buffer
    ↓
new File([buffer], 'voice.ogg', { type: 'audio/ogg' })
    ↓
openai.audio.transcriptions.create({
  model: 'whisper-1',
  file,
  language: 'ru'
}) → text
    ↓
messageText = transcribedText
```

### Требования

- Переменная `OPENAI_API_KEY` должна быть задана в `.env`
- Если не задана — голосовые сообщения не поддерживаются (бот предупреждает в лог)
- Поддерживаются: `msg.voice` (голосовые) и `msg.video_note` (видеосообщения-кружочки)
- Язык фиксирован: `ru` (русский)

---

## 12. Фотографии (референс-изображения)

### Flow

```
msg.photo (массив размеров)
    ↓
msg.photo[msg.photo.length - 1] → largestPhoto (лучшее качество)
    ↓
bot.getFileLink(largestPhoto.file_id) → photoUrl
    ↓
Инжект в текст сообщения:
  - С подписью: "{caption}\n\n[Пользователь приложил референс-изображение: {URL}]"
  - Без подписи: "[Пользователь отправил референс-изображение: {URL}]"
```

### Использование в tools

Tools `generateCreatives` и `generateCarousel` принимают `reference_image_url` — Claude автоматически передаёт URL из сообщения.

---

## 13. Docker и деплой

### Dockerfile

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm i
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
COPY groups ./groups
RUN mkdir -p data
ENV NODE_ENV=production
CMD ["npm", "start"]
```

### docker-compose.yml

```yaml
telegram-claude-bot:
  build: ./services/telegram-claude-bot
  container_name: telegram-claude-bot
  labels:
    logging: "promtail"
  env_file:
    - ./services/telegram-claude-bot/.env
  environment:
    - NODE_ENV=production
    - BRAIN_SERVICE_URL=http://agent-brain:7080
  volumes:
    - telegram-bot-data:/app/data
  restart: unless-stopped
  depends_on:
    - agent-brain
```

### Команды

| Среда | Команда | Описание |
|-------|---------|----------|
| Dev | `npm run dev` | Запуск через tsx (hot reload TS) |
| Build | `npm run build` | Компиляция TS → JS (tsc) |
| Production | `npm start` | Запуск `node dist/index.js` |
| Docker | `docker-compose up telegram-claude-bot` | Docker container |

---

## 14. Правила доработки

### 14.1 Добавление нового tool (чеклист)

При добавлении нового tool нужно изменить **5 файлов** в **2 сервисах**:

**agent-brain (3 файла):**

| # | Файл | Что делать |
|---|------|-----------|
| 1 | `agents/{category}/toolDefs.js` | Добавить Zod-схему с description и meta |
| 2 | `agents/{category}/handlers.js` | Добавить async handler функцию |
| 3 | `mcp/tools/definitions.js` | `createMCPTool()` + добавить в массив категории |

**telegram-claude-bot (2 файла):**

| # | Файл | Что делать |
|---|------|-----------|
| 4 | `src/tools.ts` | Добавить Anthropic Tool определение (JSON Schema) |
| 5 | `groups/main/CLAUDE.md` | Добавить описание tool + правило когда использовать |

### 14.2 Шаблон для нового tool

**Шаг 1 — toolDefs.js:**
```javascript
export const MyToolDefs = {
  myNewTool: {
    description: 'Описание для Claude — когда вызывать этот tool',
    schema: z.object({
      param1: z.string().describe('Описание параметра'),
      param2: z.number().optional(),
    }),
    meta: { timeout: 15000, retryable: true }
    // Для опасных operations добавить: dangerous: true
  },
};
```

**Шаг 2 — handlers.js:**
```javascript
export const myHandlers = {
  async myNewTool({ param1, param2 }, { userAccountId }) {
    const { data, error } = await supabase
      .from('my_table')
      .select('*')
      .eq('user_account_id', userAccountId);

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, data };
  },
};
```

**Шаг 3 — definitions.js:**
```javascript
import { MyToolDefs } from '../../chatAssistant/agents/myCategory/toolDefs.js';
import { myHandlers } from '../../chatAssistant/agents/myCategory/handlers.js';

export const myCategoryTools = [
  createMCPTool('myNewTool', MyToolDefs.myNewTool, myHandlers.myNewTool, 'myCategory'),
];

export const allMCPTools = [
  ...whatsappTools, ...crmTools, ...creativeTools, ...adsTools,
  ...tikTokAdsTools, ...systemTools, ...myCategoryTools  // <- добавить
];
```

**Шаг 4 — tools.ts:**
```typescript
// ===== MY CATEGORY =====
{
  name: 'myNewTool',
  description: 'Описание для Anthropic API',
  input_schema: {
    type: 'object',
    properties: {
      userAccountId: { type: 'string' },
      param1: { type: 'string', description: 'Описание' },
      param2: { type: 'number' },
    },
    required: ['userAccountId', 'param1'],
  },
},
```

**Шаг 5 — CLAUDE.md:**
```markdown
### My Category Tools
- `myNewTool` - краткое описание для бота

## Важные правила работы
12. **МОЯ НОВАЯ ФУНКЦИЯ:**
    - Триггерные фразы: "...", "..." → вызови `myNewTool`
    - Формат вывода: ...
```

### 14.3 Добавление новой категории агентов

1. Создать папку `agent-brain/src/chatAssistant/agents/{newCategory}/`
2. Создать `toolDefs.js` + `handlers.js` (по шаблону выше)
3. В `definitions.js` — импорт + массив `{newCategory}Tools` + добавить в `allMCPTools`
4. В `tools.ts` — секция `// ===== NEW CATEGORY =====`
5. В `CLAUDE.md` — раздел `### New Category Tools` + правило в "Важные правила работы"

### 14.4 Частые ошибки при доработке

| Ошибка | Симптом | Решение |
|--------|---------|---------|
| Tool не добавлен в `CLAUDE.md` | Claude не вызывает tool, хотя он существует | Добавить описание в CLAUDE.md |
| Tool не добавлен в `tools.ts` | Anthropic API не знает про tool → Claude не видит | Добавить определение в массив tools |
| Tool не добавлен в `allMCPTools` | agent-brain отвечает 404 | Добавить `...categoryTools` в allMCPTools |
| Имена не совпадают | tools.ts: `getErrors`, definitions.js: `getUserErrors` → 404 | Имена должны совпадать во всех 5 файлах |
| Нет таймаута для тяжёлого tool | Timeout через 30 секунд | Добавить в `TOOL_TIMEOUTS` в tools.ts |
| Не передан userAccountId | Handler получает null, запрос к БД пустой | Бот инжектит автоматически; в handler проверять context |
| Ошибка в Zod-схеме | agent-brain крашится при старте | Проверить импорты и синтаксис Zod |

---

## 15. Безопасность

### Защита данных пользователей

- **userAccountId** привязан к `telegram_id` через Supabase
- `getCredentials()` проверяет ownership — пользователь видит только свои данные
- Каждый handler фильтрует по `user_account_id` или `userAccountId`

### Защита API

- Tool name validation: regex `/^[a-zA-Z][a-zA-Z0-9_]*$/` — предотвращает injection
- Timeout на выполнение tools (2 минуты по умолчанию на стороне agent-brain)
- Rate limiting через Telegram Bot API (встроенный)

### Защита промпта

В `CLAUDE.md` явно указано:
```
НИКОГДА НЕ РАСКРЫВАЙ:
- API ключи (ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, и т.д.)
- Переменные окружения (env)
- Пути к файлам на сервере
- Конфиденциальную информацию о системе
```

### Dangerous tools

WRITE-операции (пауза, бюджеты) помечены как `dangerous: true` в agent-brain. В CLAUDE.md правило 6:
> "ВСЕГДА запрашивай подтверждение перед WRITE операциями (pause, resume, update budget)"

---

## 16. Отключённые компоненты

Эти компоненты реализованы, но **не используются** в текущей конфигурации Telegram бота:

| Компонент | Файл | Описание | Статус |
|-----------|------|----------|--------|
| Task Scheduler | `task-scheduler.ts` | Cron/interval/once задачи | Отключён в index.ts (закомментирован) |
| Container Runner | `container-runner.ts` | Запуск Docker контейнеров для изолированного выполнения | NanoClaw legacy, не используется |
| Mount Security | `mount-security.ts` | Валидация mount points для контейнеров | NanoClaw legacy, не используется |

Планировщик можно включить, раскомментировав `startSchedulerLoop()` в `index.ts`. Container Runner и Mount Security ориентированы на WhatsApp-бот и не применимы к Telegram.
