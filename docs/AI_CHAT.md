# AI Chat - Claude Agent SDK Integration

## Обзор

AI Chat в agent-brain использует **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) как основной LLM провайдер с fallback на OpenAI.

## Архитектура

```
Frontend (React)
     │
     ▼
/api/brain/chat/stream (SSE)
     │
     ▼
Orchestrator (index.js)
     │
     ├── LLM_PROVIDER=claude ──▶ claudeOrchestrator.js
     │                                   │
     │                                   ▼
     │                          Claude Agent SDK
     │                          (query() function)
     │
     └── LLM_PROVIDER=openai ──▶ metaOrchestrator.js
                                         │
                                         ▼
                                   OpenAI API
```

## Файлы

| Файл | Описание |
|------|----------|
| `src/chatAssistant/orchestrator/index.js` | Entry point, роутинг между Claude и OpenAI |
| `src/chatAssistant/orchestrator/claudeOrchestrator.js` | Claude Agent SDK orchestrator |
| `src/chatAssistant/orchestrator/metaOrchestrator.js` | OpenAI orchestrator (fallback) |
| `src/chatAssistant/metaTools/claudeAdapter.js` | Адаптер для маппинга SDK → SSE events |
| `src/chatAssistant/config.js` | Конфигурация LLM провайдеров |

## Конфигурация

### Переменные окружения (.env.brain)

```bash
# LLM Provider: 'claude' | 'openai'
LLM_PROVIDER=claude

# Claude API Key
ANTHROPIC_API_KEY=sk-ant-api03-...

# Claude Model (полное имя с датой)
CLAUDE_MODEL=claude-sonnet-4-20250514

# Max turns для agent loop
CLAUDE_MAX_TURNS=10

# Fallback на OpenAI при ошибках Claude
LLM_FALLBACK=true

# Skills support
CLAUDE_ENABLE_SKILLS=true

# Timeout (ms)
CLAUDE_TIMEOUT_MS=120000
```

### Доступные модели Claude

| Model ID | Описание |
|----------|----------|
| `claude-sonnet-4-20250514` | Claude 4 Sonnet (рекомендуется) |
| `claude-opus-4-20250514` | Claude 4 Opus (более мощный) |
| `claude-3-5-sonnet-latest` | Claude 3.5 Sonnet |

## SSE Events

Frontend получает стандартные SSE события:

```typescript
// Инициализация
{ type: 'init', conversationId: string, mode: 'auto' | 'plan' }

// Думает
{ type: 'thinking', message: string }

// Текст ответа (streaming)
{ type: 'text', content: string, accumulated: string }

// Начало выполнения tool
{ type: 'tool_start', name: string, args: object }

// Результат tool
{ type: 'tool_result', name: string, success: boolean, duration: number }

// Завершение
{ type: 'done', content: string, executedActions: [], plan?: object }

// Ошибка
{ type: 'error', message: string, isTimeout?: boolean }
```

## Fallback механизм

При ошибке Claude автоматически переключается на OpenAI:

1. Claude возвращает ошибку (404, timeout, etc.)
2. Если `LLM_FALLBACK=true`, запрос перенаправляется на OpenAI
3. В логах появляется `provider: 'openai-fallback'`
4. Frontend получает ответ без прерывания

## Логирование

Claude orchestrator пишет детальные логи:

```json
{
  "requestId": "claude-1706456789-abc123",
  "model": "claude-sonnet-4-20250514",
  "maxTurns": 10,
  "timeoutMs": 120000,
  "messageLength": 42,
  "historyLength": 5
}
```

Ключевые поля для отладки:
- `requestId` - уникальный ID запроса
- `messageCount` - количество SDK сообщений
- `totalInputTokens` / `totalOutputTokens` - использование токенов
- `latencyMs` - общее время выполнения

## Skills Support

Claude Agent SDK поддерживает skills из `.claude/skills/`:

- `/ads-optimizer` - оптимизация рекламы
- `/campaign-manager` - создание кампаний
- `/creative-analyzer` - анализ креативов
- `/targeting-expert` - настройка таргетинга
- `/ads-reporter` - отчёты

Skills загружаются через `settingSources: ['project']` в опциях SDK.

## Troubleshooting

### Model not found (404)

```
API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-4"}}
```

**Решение**: Используйте полное имя модели с датой: `claude-sonnet-4-20250514`

### Timeout

```
Claude query exceeded total timeout of 120000ms
```

**Решение**: Увеличьте `CLAUDE_TIMEOUT_MS` или оптимизируйте промпт.

### Fallback не работает

1. Проверьте `LLM_FALLBACK=true` в `.env.brain`
2. Проверьте наличие валидного `OPENAI_API_KEY`
3. Проверьте логи на `Claude failed, falling back to OpenAI`

## Docker

Dockerfile использует `--legacy-peer-deps` для совместимости с zod:

```dockerfile
RUN npm ci --omit=dev --legacy-peer-deps
```

## Зависимости

```json
{
  "@anthropic-ai/claude-agent-sdk": "^0.2.22"
}
```

Требования:
- Node.js 18+
- zod (peer dependency, любая версия 3.x или 4.x)

## История изменений

### 2026-01-28
- Миграция с OpenAI GPT-5.2 на Claude Agent SDK
- Добавлен fallback механизм
- Добавлено детальное логирование
- Добавлен timeout handling
