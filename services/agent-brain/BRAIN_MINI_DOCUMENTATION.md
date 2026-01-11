# Brain Mini — AI-агент для управления Facebook Ads

## Оглавление
1. [Обзор](#1-обзор)
2. [Структура проекта](#2-структура-проекта)
3. [Chat Assistant](#3-chat-assistant)
4. [API Endpoints](#4-api-endpoints)
5. [Domain Agents и их Tools](#5-domain-agents-и-их-tools)
6. [AI Модели](#6-ai-модели)
7. [Бизнес-логика](#7-бизнес-логика)
8. [Интеграции](#8-интеграции)
9. [Конфигурация](#9-конфигурация)
10. [Deployment](#10-deployment)
11. [Диаграммы](#11-диаграммы)

---

## 1. Обзор

### Назначение
**Brain Mini** (agent-brain) — это AI-агент для автоматизированного управления рекламными кампаниями в Facebook Ads. Использует OpenAI GPT модели для анализа метрик, принятия решений по оптимизации бюджетов и предоставления рекомендаций.

### Ключевые возможности
- **Скоринг кампаний** — расчёт Health Score (HS) для оценки эффективности
- **Автоматическая оптимизация** — изменение бюджетов, пауза неэффективных adsets
- **Chat Assistant** — интерактивный AI-ассистент для управления рекламой
- **Multi-account режим** — поддержка нескольких рекламных аккаунтов
- **TikTok Ads** — интеграция с TikTok рекламой

### Технический стек
| Компонент | Технология |
|-----------|-----------|
| Runtime | Node.js 20+ (ES Modules) |
| HTTP Server | Fastify 4.x |
| Database | Supabase (PostgreSQL) |
| AI/LLM | OpenAI GPT-4.1, GPT-5.2, GPT-4o-mini |
| Ads API | Facebook Graph API v23.0, TikTok Ads API |
| Messaging | Evolution API (WhatsApp), Telegram Bot API |

---

## 2. Структура проекта

```
services/agent-brain/
├── src/
│   ├── server.js                    # Fastify HTTP сервер (порт 7080)
│   ├── scoring.js                   # Scoring Agent + Brain Mini LLM
│   ├── creativeAnalyzer.js          # Анализ креативов
│   ├── analyzerService.js           # Отдельный сервис анализа
│   │
│   ├── chatAssistant/               # Chat Assistant Module
│   │   ├── index.js                 # Entry point + processChat()
│   │   ├── config.js                # Конфигурация моделей
│   │   ├── contextGatherer.js       # Сбор контекста (directions, metrics)
│   │   ├── planExecutor.js          # Выполнение планов действий
│   │   │
│   │   ├── orchestrator/            # Meta-Tools Orchestrator
│   │   │   ├── index.js             # Класс Orchestrator
│   │   │   ├── metaOrchestrator.js  # Meta-tools обработка
│   │   │   ├── metaSystemPrompt.js  # System prompt генератор
│   │   │   └── memoryTools.js       # Инструменты памяти
│   │   │
│   │   ├── metaTools/               # Meta-Tools система
│   │   │   ├── index.js             # Entry point
│   │   │   ├── definitions.js       # Определения meta-tools
│   │   │   ├── domainRouter.js      # Маршрутизация по доменам
│   │   │   ├── domainAgents.js      # Domain agents обработка
│   │   │   ├── executor.js          # Выполнение tools
│   │   │   ├── mcpBridge.js         # MCP интеграция
│   │   │   └── formatters.js        # Форматирование результатов
│   │   │
│   │   ├── agents/                  # Domain Agents
│   │   │   ├── ads/                 # AdsAgent (Facebook Ads)
│   │   │   │   ├── toolDefs.js      # 19 tools (11 READ + 8 WRITE)
│   │   │   │   ├── handlers.js      # Handlers для tools
│   │   │   │   └── tools.js         # Tool implementations
│   │   │   ├── creative/            # CreativeAgent
│   │   │   │   ├── toolDefs.js      # 16 tools (10 READ + 6 WRITE)
│   │   │   │   └── handlers.js
│   │   │   ├── crm/                 # CRMAgent
│   │   │   │   ├── toolDefs.js      # 12 tools (10 READ + 2 WRITE)
│   │   │   │   └── handlers.js
│   │   │   ├── whatsapp/            # WhatsAppAgent
│   │   │   │   ├── toolDefs.js      # 4 READ tools
│   │   │   │   └── handlers.js
│   │   │   └── tiktok/              # TikTokAgent
│   │   │       ├── toolDefs.js      # 24 tools
│   │   │       └── handlers.js
│   │   │
│   │   ├── shared/                  # Общие утилиты
│   │   │   ├── brainRules.js        # Health Score, бизнес-правила
│   │   │   ├── fbGraph.js           # Facebook Graph API wrapper
│   │   │   ├── tikTokGraph.js       # TikTok API wrapper
│   │   │   ├── reportFormatter.js   # Форматирование отчётов
│   │   │   ├── circuitBreaker.js    # Circuit breaker для API
│   │   │   ├── dateUtils.js         # Работа с датами
│   │   │   └── layerLogger.js       # Layer logging
│   │   │
│   │   ├── stores/                  # Data stores
│   │   │   ├── memoryStore.js       # Память пользователя (specs, notes)
│   │   │   ├── unifiedStore.js      # Conversations & messages
│   │   │   ├── runsStore.js         # История выполнений
│   │   │   └── idempotencyStore.js  # Idempotency keys
│   │   │
│   │   ├── telegram/                # Telegram интеграция
│   │   │   └── approvalHandler.js   # Обработка одобрений
│   │   └── telegramHandler.js       # Telegram bot handler
│   │
│   ├── mcp/                         # Model Context Protocol
│   │   ├── index.js                 # Entry point
│   │   ├── server.js                # MCP HTTP сервер
│   │   ├── protocol.js              # MCP протокол
│   │   ├── sessions.js              # Сессии
│   │   ├── tools/                   # MCP tools
│   │   │   ├── definitions.js
│   │   │   ├── registry.js
│   │   │   └── executor.js
│   │   └── resources/
│   │       └── registry.js
│   │
│   ├── lib/                         # Утилиты
│   │   ├── logger.js                # Pino logger
│   │   ├── errorLogger.js           # Error logging
│   │   ├── supabaseClient.js        # Supabase клиент
│   │   ├── multiAccountHelper.js    # Multi-account helpers
│   │   └── logAlerts.js             # Log alerts
│   │
│   ├── amocrmLeadsSyncCron.js       # amoCRM sync cron
│   └── currencyRateCron.js          # Currency rates cron
│
├── Dockerfile
├── package.json
└── .env
```

---

## 3. Chat Assistant

### Архитектура Meta-Tools

Chat Assistant использует архитектуру **Meta-Tools** с lazy-loading инструментов:

```
┌─────────────────────────────────────────────────────────────────┐
│                     POST /api/brain/run                         │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     processChat()                                │
│  1. resolveAdAccountId() — определить рекламный аккаунт         │
│  2. getAccessToken() — получить токен FB                        │
│  3. getOrCreateConversation() — найти/создать беседу            │
│  4. gatherContext() — собрать контекст                          │
│  5. saveMessage() — сохранить сообщение пользователя            │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Orchestrator.processRequest()                │
│  ├─ parseMemoryCommand() — проверить команды памяти             │
│  └─ processWithMetaTools() — основная обработка                 │
│     ├─ buildMetaSystemPrompt() — сгенерировать промпт           │
│     ├─ GPT-5.2 (thinking model) — анализ запроса                │
│     └─ routeToolCallsToDomains() — маршрутизация                │
│        ├─ AdsAgent (Facebook Ads)                               │
│        ├─ CreativeAgent (креативы)                              │
│        ├─ CRMAgent (лиды, воронка)                              │
│        ├─ WhatsAppAgent (диалоги)                               │
│        └─ TikTokAgent (TikTok Ads)                              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. saveMessage() — сохранить ответ ассистента                  │
│  7. Return response                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 4 Meta-Tools

| Meta-Tool | Описание |
|-----------|----------|
| `getAvailableDomains()` | Получить список доступных доменов (ads, creative, crm, whatsapp) |
| `getDomainTools(domain)` | Загрузить tools конкретного домена |
| `executeTools(tools, user_question)` | Выполнить tools и получить готовый ответ от агента |
| `executeTool(tool_name, arguments)` | [deprecated] Прямой вызов инструмента |

### Режимы работы

| Режим | Описание |
|-------|----------|
| `auto` | Автоматическое выполнение (default) |
| `plan` | Генерация плана без выполнения |
| `ask` | Требует подтверждения для DANGEROUS tools |

---

## 4. API Endpoints

### Основные endpoints

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/brain/run` | POST | Основной chat endpoint |
| `/api/brain/mini/run/stream` | POST | Streaming endpoint для Brain Mini |
| `/api/brain/decide` | POST | Принятие решений (optimize/pause/resume) |
| `/api/brain/llm-ping` | GET | Health-check LLM |
| `/api/brain/test-scoring` | POST | Тестирование scoring agent |
| `/api/brain/test-merger` | POST | Тестирование Smart Merger |
| `/api/brain/test-fb-adsets` | GET | Тест FB API adsets |

### Cron endpoints

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/brain/cron/check-users` | GET | Проверка активных пользователей |
| `/api/brain/cron/run-batch` | POST | Запуск батча обработки |
| `/api/brain/cron/batch-report` | GET | Отчёт по батчу |
| `/api/brain/cron/update-currency` | POST | Обновление курсов валют |

### POST `/api/brain/run`

**Request:**
```json
{
  "userAccountId": "uuid",
  "adAccountId": "uuid|fbId",
  "conversationId": "uuid",
  "message": "Как дела с CPL?",
  "mode": "auto|plan|ask",
  "debugLayers": true
}
```

**Response:**
```json
{
  "success": true,
  "conversationId": "uuid",
  "response": {
    "content": "...",
    "classification": { "domain": "ads", "agents": ["AdsAgent"] },
    "executedActions": []
  },
  "model": "gpt-5.2",
  "duration": 2340
}
```

---

## 5. Domain Agents и их Tools

### AdsAgent (19 tools: 11 READ + 8 WRITE)

**READ Tools:**
| Tool | Описание | Timeout |
|------|----------|---------|
| `getCampaigns` | Список кампаний с метриками (расходы, лиды, CPL, CTR) | 25s |
| `getCampaignDetails` | Детальная информация о кампании | 25s |
| `getAdSets` | Список адсетов кампании с метриками | 20s |
| `getAds` | Статистика на уровне объявлений | 30s |
| `getSpendReport` | Отчёт по расходам с группировкой | 25s |
| `getDirections` | Список направлений с метриками | 20s |
| `getDirectionCreatives` | Креативы направления | 20s |
| `getDirectionMetrics` | Метрики направления по дням | 20s |
| `getAdAccountStatus` | Статус рекламного аккаунта | 15s |
| `getDirectionInsights` | Метрики с delta vs prev period | 25s |
| `getLeadsEngagementRate` | QCPL метрика (качественные лиды) | 30s |

**WRITE Tools (⚠️ dangerous):**
| Tool | Описание | Timeout |
|------|----------|---------|
| `pauseAdSet` | Пауза адсета | 15s |
| `resumeAdSet` | Возобновление адсета | 15s |
| `pauseAd` | Пауза объявления | 15s |
| `resumeAd` | Возобновление объявления | 15s |
| `updateBudget` | Изменение бюджета адсета | 15s |
| `pauseDirection` | Пауза направления | 20s |
| `resumeDirection` | Возобновление направления | 20s |
| `updateDirectionBudget` | Изменение бюджета направления | 15s |

### CreativeAgent (16 tools: 10 READ + 6 WRITE)

**READ Tools:**
- `getCreatives` — список креативов
- `getCreativeDetails` — детали креатива
- `getCreativeMetrics` — метрики с video retention
- `getCreativeAnalysis` — LLM анализ
- `getTopCreatives` — топ креативы по метрике
- `getWorstCreatives` — худшие креативы
- `getCreativeTests` — история A/B тестов
- `analyzeCreativeTest` — анализ теста
- `getCreativeRetention` — video retention метрики
- `searchCreatives` — поиск креативов

**WRITE Tools:**
- `launchCreative` — запуск креатива
- `pauseCreative` — остановка
- `deleteCreative` — удаление
- `startCreativeTest` — запуск A/B теста
- `generateCreatives` — генерация через LLM
- `updateCreativeMetadata` — обновление метаданных

### CRMAgent (12 tools: 10 READ + 2 WRITE)

**READ Tools:**
- `getLeads` — список лидов
- `getLeadDetails` — полная карточка
- `getFunnelStats` — статистика воронки
- `getRevenueStats` — финансовая статистика
- `getLeadsByDirection` — лиды направления
- `getLeadsEngagementRate` — качество лидов
- `getCRMIntegrations` — подключённые CRM
- `searchLeads` — поиск лидов
- `getLeadTimeline` — история лида
- `getAMOCRMLogs` — логи amoCRM синхронизации

**WRITE Tools:**
- `updateLeadStage` — изменение стадии лида
- `syncAmoCRMLeads` — синхронизация с amoCRM

### WhatsAppAgent (4 READ tools)

- `getDialogs` — список диалогов
- `getDialogMessages` — история переписки
- `analyzeDialog` — AI-анализ диалога
- `searchDialogSummaries` — полнотекстовый поиск

### TikTokAgent (24 tools)

Аналогичен AdsAgent, но для TikTok Ads:
- CRUD операции с кампаниями, адгруппами, объявлениями
- Загрузка видео по URL
- Метрики и ROI отчёты
- Cross-platform сравнение (TikTok vs Facebook)

---

## 6. AI Модели

### Конфигурация (`config.js`)

```javascript
export const ORCHESTRATOR_CONFIG = {
  model: process.env.META_ORCHESTRATOR_MODEL || 'gpt-5.2',        // Orchestrator
  domainAgentModel: process.env.DOMAIN_AGENT_MODEL || 'gpt-4o-mini', // Domain agents
  maxIterations: parseInt(process.env.META_MAX_ITERATIONS || '10', 10),
  debugMode: process.env.ORCHESTRATOR_DEBUG === 'true',
  enableLayerLogging: process.env.ENABLE_LAYER_LOGGING === 'true'
};
```

### Используемые модели

| Модель | Назначение | API |
|--------|-----------|-----|
| **GPT-5.2** | Meta-Tools Orchestrator (thinking) | OpenAI Responses API |
| **GPT-4.1** | Scoring Agent (Brain Mini) | OpenAI Responses API |
| **GPT-4o-mini** | Domain Agents (обработка данных) | OpenAI Chat Completions |

### OpenAI Responses API

Brain Mini использует OpenAI Responses API (не стандартный Chat Completions):

```javascript
const resp = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'authorization': `Bearer ${process.env.OPENAI_API_KEY}`
  },
  body: JSON.stringify({
    model: 'gpt-4.1',
    input: [
      { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'input_text', text: userPayload }] }
    ],
    reasoning: 'medium',
    temperature: 0.7
  })
});
```

### Таймауты и retry

```javascript
const LLM_TIMEOUT_MS = 240000;  // 4 минуты
const maxRetries = 3;

// Exponential backoff: 1s, 2s, 4s... (max 15s)
const baseDelay = 1000 * Math.pow(2, attempt - 1);
const jitter = Math.random() * 500;
const delay = Math.min(baseDelay + jitter, 15000);
```

---

## 7. Бизнес-логика

### Health Score (HS) система

**Файл:** `src/chatAssistant/shared/brainRules.js`

Health Score ∈ [-100; +100] — интегральная оценка эффективности ad set.

#### Компоненты HS

| Компонент | Вес | Описание |
|-----------|-----|----------|
| **Gap к таргету** | 45% | CPL/CPC относительно target |
| **Тренды** | 15% | 3d vs 7d, 7d vs 30d |
| **Диагностика** | до -30 | CTR, CPM, frequency |
| **Новизна** | до -10 | Штраф для adsets < 48ч |
| **Объём** | множитель 0.6-1.0 | Если impressions < 1000 |
| **Today-компенсация** | бонус | Если сегодня 2x лучше вчера |

#### Классы HS

```javascript
export const HS_CLASSES = {
  VERY_GOOD: 25,     // ≥ +25 — масштабировать
  GOOD: 5,           // +5..+24 — держать
  NEUTRAL_LOW: -5,   // -5..+4 — наблюдать
  SLIGHTLY_BAD: -25, // -25..-6 — снижать
  BAD: -100          // ≤ -25 — пауза
};
```

#### Матрица действий

| HS Класс | Действие | Детали |
|----------|----------|--------|
| **very_good** | Масштабировать | +10..+30% бюджета |
| **good** | Держать | +0..+10% при недоборе |
| **neutral** | Наблюдать | Проверить ads-пожиратели |
| **slightly_bad** | Снижать | -20..-50% бюджета |
| **bad** | Пауза | -50% или полная пауза |

### Ad-Eater Detection

**Пороги для обнаружения неэффективных объявлений:**

```javascript
export const AD_EATER_THRESHOLDS = {
  MIN_SPEND_FOR_ANALYSIS: 3,    // $3 минимум
  MIN_IMPRESSIONS: 300,          // Минимум показов
  CPL_CRITICAL_MULTIPLIER: 3,    // CPL > 3x от таргета
  SPEND_SHARE_CRITICAL: 0.5      // >50% бюджета адсета
};
```

### Budget Limits

```javascript
export const BUDGET_LIMITS = {
  MAX_INCREASE_PCT: 30,   // +30% max за шаг
  MAX_DECREASE_PCT: 50,   // -50% max за шаг
  MIN_CENTS: 300,         // $3 минимум
  MAX_CENTS: 10000,       // $100 максимум
  NEW_ADSET_MIN: 1000,    // $10 для нового adset
  NEW_ADSET_MAX: 2000     // $20 для нового adset
};
```

### Timeframe Weights

```javascript
export const TIMEFRAME_WEIGHTS = {
  yesterday: 0.50,  // 50% — приоритет
  last_3d: 0.25,    // 25%
  last_7d: 0.15,    // 15%
  last_30d: 0.10    // 10%
};
```

### Today-компенсация

```javascript
export const TODAY_COMPENSATION = {
  FULL: 0.5,      // eCPL_today ≤ 0.5 × eCPL_yesterday → полная компенсация
  PARTIAL: 0.7,   // eCPL_today ≤ 0.7 × eCPL_yesterday → 60% компенсация
  SLIGHT: 0.9     // eCPL_today ≤ 0.9 × eCPL_yesterday → +5 бонус
};
```

### Метрики по типам кампаний

| Objective | Метрика | Формула |
|-----------|---------|---------|
| whatsapp | CPL | spend / conversations_started |
| lead_forms | CPL | spend / form_leads |
| site_leads | CPL | spend / pixel_leads |
| instagram_traffic | CPC | spend / link_clicks |

---

## 8. Интеграции

### Facebook Graph API

**Файл:** `src/chatAssistant/shared/fbGraph.js`

```javascript
const FB_API_VERSION = 'v23.0';

export async function fbGraph(method, path, accessToken, params = {}, options = {}) {
  // method: 'GET' | 'POST'
  // path: например '/act_{accountId}/campaigns'
  // options: { maxRetries: 2, timeout: 25000, retryDelay: 1000 }
}
```

**Circuit Breaker:**
```javascript
// Failure threshold: 5
// Timeout to HALF_OPEN: 60 секунд
// Success threshold: 2
```

**Retryable FB error codes:** 17 (user limit), 4 (app limit), 32 (page limit)

### Supabase

**Файл:** `src/lib/supabaseClient.js`

```javascript
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
```

**Основные таблицы:**
- `user_accounts` — пользователи
- `ad_accounts` — рекламные аккаунты
- `directions` — направления
- `conversations` — беседы с AI
- `messages` — сообщения
- `brain_executions` — история выполнений Brain

### amoCRM

**Файл:** `src/amocrmLeadsSyncCron.js`

Синхронизация лидов с amoCRM через cron job.

### Telegram

**Файлы:**
- `src/chatAssistant/telegramHandler.js`
- `src/chatAssistant/telegram/approvalHandler.js`

Отправка уведомлений и обработка одобрений через Telegram бота.

---

## 9. Конфигурация

### Переменные окружения (.env)

```env
# LLM Configuration
OPENAI_API_KEY=sk-proj-...
BRAIN_MODEL=gpt-4.1
META_ORCHESTRATOR_MODEL=gpt-5.2
DOMAIN_AGENT_MODEL=gpt-4o-mini

# Server
BRAIN_PORT=7080
BRAIN_USE_LLM=true

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiI...

# Facebook
FB_API_VERSION=v23.0

# Telegram
TELEGRAM_BOT_TOKEN=7263071246:AAF...
TELEGRAM_FALLBACK_BOT_TOKEN=...
MONITORING_CHAT_ID=...

# External Services
AGENT_SERVICE_URL=https://agent2.performanteaiagency.com

# MCP
MCP_ENABLED=false
MCP_SERVER_URL=http://localhost:7080/mcp

# Multi-account
HYBRID_ENABLED=true

# Debug
ORCHESTRATOR_DEBUG=false
ENABLE_LAYER_LOGGING=false
META_MAX_ITERATIONS=10
```

### package.json

```json
{
  "name": "agent-brain",
  "version": "0.1.0",
  "type": "module",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "start:analyzer": "node src/analyzerService.js",
    "dev": "node --watch src/server.js"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.1",
    "@modelcontextprotocol/sdk": "^1.25.0",
    "@supabase/supabase-js": "^2.46.1",
    "fastify": "^4.28.1",
    "node-cron": "^3.0.3",
    "openai": "^4.57.0",
    "pino": "^10.0.0",
    "zod": "^3.25.76"
  }
}
```

---

## 10. Deployment

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm i --omit=dev
COPY src ./src
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
```

### Порты

| Сервис | Порт |
|--------|------|
| Brain Server | 7080 |
| Analyzer Service | 7081 (optional) |

### Запуск

```bash
# Production
npm start

# Development (с hot reload)
npm run dev

# Analyzer service
npm run start:analyzer
```

### CORS

Разрешённые origins:
```javascript
const ALLOWED_ORIGINS = [
  // Production
  'https://app.performanteaiagency.com',
  'https://brain2.performanteaiagency.com',
  // Development
  'http://localhost:3001',
  'http://localhost:8082'
];
```

---

## 11. Диаграммы

### Архитектурная диаграмма

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Frontend (React)                               │
│                        https://app.performanteaiagency.com              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ POST /api/brain/run
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Brain Server (Fastify :7080)                        │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Chat Assistant                              │   │
│  │                                                                  │   │
│  │  ┌──────────────────┐    ┌───────────────────────────────────┐ │   │
│  │  │ Context Gatherer │───▶│        Orchestrator               │ │   │
│  │  └──────────────────┘    │                                   │ │   │
│  │                          │  ┌─────────────────────────────┐  │ │   │
│  │                          │  │   Meta-Tools System          │  │ │   │
│  │                          │  │   (GPT-5.2 Thinking)         │  │ │   │
│  │                          │  └─────────────────────────────┘  │ │   │
│  │                          │              │                     │ │   │
│  │                          └──────────────┼─────────────────────┘ │   │
│  │                                         │                        │   │
│  │           ┌─────────────────────────────┼───────────────────┐   │   │
│  │           ▼              ▼              ▼              ▼     │   │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────┐│   │   │
│  │  │ AdsAgent    │ │CreativeAgent│ │ CRMAgent    │ │WhatsApp ││   │   │
│  │  │ (19 tools)  │ │ (16 tools)  │ │ (12 tools)  │ │(4 tools)││   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────┘│   │   │
│  │                                                              │   │   │
│  └──────────────────────────────────────────────────────────────┘   │   │
│                                                                      │   │
│  ┌─────────────────────────────────────────────────────────────────┐│   │
│  │                   Scoring Agent (GPT-4.1)                        ││   │
│  │  - Health Score calculation                                      ││   │
│  │  - Ad-Eater detection                                            ││   │
│  │  - Budget proposals                                              ││   │
│  └─────────────────────────────────────────────────────────────────┘│   │
│                                                                      │   │
└──────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Facebook Graph  │  │    Supabase     │  │    Telegram     │
│  API v23.0      │  │   (PostgreSQL)  │  │    Bot API      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Flow диаграмма Brain Mini

```
┌──────────────────────────────────────────────────────────────────┐
│                        Brain Mini Flow                            │
└──────────────────────────────────────────────────────────────────┘

1. Получение данных
   ├── fetchAdsets() — активные adsets из FB API
   ├── fetchInsightsPreset(yesterday/3d/7d/30d/today) — метрики
   └── getUserDirections() — направления из Supabase

2. Расчёт Health Score для каждого adset
   ├── Gap к target CPL/CPC (±45 points)
   ├── Тренды 3d vs 7d (+/-15 points)
   ├── Диагностика CTR/CPM/Frequency (-30 max)
   ├── Today-компенсация (бонус при хороших результатах сегодня)
   └── Volume confidence (множитель 0.6-1.0)

3. Генерация proposals через LLM
   ├── System prompt с правилами Brain
   ├── Input: adsets + metrics + directions + targets
   └── Output: JSON с proposals

4. Форматирование отчёта
   ├── Человекочитаемые описания
   ├── Бюджеты в $ (USD)
   └── Группировка по приоритету

5. Сохранение в brain_executions
   └── execution_mode: 'manual_trigger' | 'autopilot'
```

---

## Недавние изменения (2026)

### Январь 2026

| Коммит | Описание |
|--------|----------|
| `422cb42` | Анализ ads-пожирателей, улучшение отчёта оптимизации |
| `919d29f` | Выборочное одобрение шагов, reportFormatter.js |
| `b60adc1` | Фильтрация по конкретной кампании (campaignId) |
| `8ba6021` | Увеличение таймаутов, gpt-5-mini, llmPlanMini |
| `1d82f17` | Streaming endpoint, внешние кампании, USD валюта |

### Декабрь 2025

| Коммит | Описание |
|--------|----------|
| `addf374` | TikTok Ads интеграция (24 новых tools) |
| `9e17841` | Manual mode для пользователей без directions |
| `2cf7649` | CPC поддержка для Instagram Traffic |
| `7e4a1ef` | Изоляция autopilot per ad_account |
| `25114a0` | Multi-account режим (shouldFilterByAccountId) |

---

## Полезные команды

```bash
# Запуск в development
cd services/agent-brain && npm run dev

# Проверка LLM
curl http://localhost:7080/api/brain/llm-ping

# Тест scoring
curl -X POST http://localhost:7080/api/brain/test-scoring \
  -H "Content-Type: application/json" \
  -d '{"userAccountId": "UUID"}'

# Docker build
docker build -t agent-brain .

# Docker run
docker run -p 7080:7080 --env-file .env agent-brain
```

---

*Документация сгенерирована 11 января 2026*
