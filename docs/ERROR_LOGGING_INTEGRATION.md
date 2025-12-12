# Централизованное логирование ошибок - Итерация 2

## Обзор

Реализована полная интеграция централизованного логирования ошибок во все catch блоки микросервисов:
- **agent-service** (Fastify, TypeScript)
- **agent-brain** (Node.js, JavaScript)
- **creative-generation-service** (Fastify, TypeScript)

Все ошибки отправляются на единый endpoint `POST /admin/errors/log` в agent-service, где:
1. Сохраняются в таблицу `error_logs` в Supabase
2. Автоматически анализируются GPT-4o-mini для генерации человекочитаемого объяснения
3. Доступны в админ-панели для мониторинга и разрешения

---

## Архитектура

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   agent-service     │     │    agent-brain      │     │ creative-generation │
│   (TypeScript)      │     │    (JavaScript)     │     │    (TypeScript)     │
├─────────────────────┤     ├─────────────────────┤     ├─────────────────────┤
│ lib/errorLogger.ts  │     │ lib/errorLogger.js  │     │ lib/errorLogger.ts  │
│ logErrorToAdmin()   │     │ logErrorToAdmin()   │     │ logErrorToAdmin()   │
└─────────┬───────────┘     └─────────┬───────────┘     └─────────┬───────────┘
          │                           │                           │
          │ HTTP POST                 │ HTTP POST                 │ HTTP POST
          │ /admin/errors/log         │ /admin/errors/log         │ /admin/errors/log
          │                           │                           │
          └───────────────────────────┼───────────────────────────┘
                                      ▼
                        ┌─────────────────────────┐
                        │   agent-service         │
                        │   POST /admin/errors/log│
                        ├─────────────────────────┤
                        │ 1. Validate input       │
                        │ 2. Save to error_logs   │
                        │ 3. Call GPT-4o-mini     │
                        │ 4. Update explanation   │
                        └─────────┬───────────────┘
                                  │
                                  ▼
                        ┌─────────────────────────┐
                        │      Supabase           │
                        │    error_logs table     │
                        └─────────────────────────┘
```

---

## API Контракт

### POST /admin/errors/log

**Request Body:**
```typescript
{
  user_account_id?: string;     // UUID пользователя (опционально)
  error_type: ErrorType;        // Тип ошибки (обязательно)
  error_code?: string;          // Код ошибки (например FB error code)
  raw_error: string;            // Текст ошибки (обязательно)
  stack_trace?: string;         // Stack trace
  action?: string;              // Действие которое выполнялось
  endpoint?: string;            // Endpoint API
  request_data?: object;        // Данные запроса (для отладки)
  severity?: ErrorSeverity;     // Уровень важности (default: 'warning')
}
```

**Error Types:**
| error_type | Описание | Используется в |
|------------|----------|----------------|
| `facebook` | Facebook/Instagram API ошибки | adAccounts, directionAdSets, facebookWebhooks |
| `amocrm` | AmoCRM API и OAuth ошибки | amocrmOAuth, amocrmPipelines, amocrmWebhooks |
| `evolution` | WhatsApp Evolution/GreenAPI | evolutionWebhooks, whatsappInstances |
| `webhook` | Входящие webhooks | bizonWebhooks, telegramWebhook |
| `creative_generation` | Генерация креативов | image.ts, carousel.ts, texts.ts |
| `scoring` | AI scoring агент | scoring.js |
| `cron` | Cron задачи | amocrmLeadsSyncCron |
| `api` | Общие API ошибки | Все остальные endpoints |

**Severity Levels:**
| severity | Когда использовать |
|----------|-------------------|
| `critical` | Webhooks (потеря лидов), Auth errors (token expired), Cron failures |
| `warning` | Стандартные API ошибки, генерация контента |
| `info` | Некритичные ошибки (парсинг cookies и т.д.) |

---

## Паттерн использования

### TypeScript (agent-service, creative-generation-service)

```typescript
import { logErrorToAdmin } from '../lib/errorLogger.js';

app.post('/endpoint', async (request, reply) => {
  const { userAccountId } = request.body;

  try {
    // ... бизнес-логика
  } catch (err: any) {
    app.log.error({ error: err.message }, 'Operation failed');

    // Fire-and-forget логирование
    logErrorToAdmin({
      user_account_id: userAccountId,
      error_type: 'api',
      raw_error: err.message || String(err),
      stack_trace: err.stack,
      action: 'operation_name',
      endpoint: '/endpoint',
      severity: 'warning'
    }).catch(() => {});

    return reply.code(500).send({
      success: false,
      error: err.message
    });
  }
});
```

### JavaScript (agent-brain)

```javascript
import { logErrorToAdmin } from '../lib/errorLogger.js';

async function someFunction(userAccountId) {
  try {
    // ... бизнес-логика
  } catch (error) {
    logger.error({ error: error.message }, 'Operation failed');

    logErrorToAdmin({
      user_account_id: userAccountId,
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'operation_name',
      severity: 'warning'
    }).catch(() => {});

    throw error;
  }
}
```

---

## Покрытые файлы

### agent-service/src/routes/ (39 файлов)

#### Webhooks (критичность: HIGH - потеря лидов)
| Файл | Catch блоков | error_type | severity |
|------|-------------|------------|----------|
| evolutionWebhooks.ts | 2 | evolution | critical |
| amocrmWebhooks.ts | 6 | amocrm | critical |
| facebookWebhooks.ts | 15+ | facebook | critical |
| greenApiWebhooks.ts | 1 | evolution | critical |
| bizonWebhooks.ts | 8 | webhook | critical |
| telegramWebhook.ts | 7 | webhook | critical |

#### Критичные API
| Файл | Catch блоков | error_type |
|------|-------------|------------|
| image.ts | 4 | api |
| video.ts | 6 | api |
| leads.ts | 4 | webhook |
| creativeTest.ts | 5 | api |
| carouselCreative.ts | 1 | api |

#### Интеграции
| Файл | Catch блоков | error_type |
|------|-------------|------------|
| adAccounts.ts | 8 | facebook |
| amocrmOAuth.ts | 10 | amocrm |
| amocrmPipelines.ts | 20+ | amocrm |
| amocrmSecrets.ts | 1 | amocrm |
| tiktokOAuth.ts | 4 | api |
| whatsappInstances.ts | 6 | evolution |
| whatsappNumbers.ts | 5 | evolution |

#### Аналитика
| Файл | Catch блоков | error_type |
|------|-------------|------------|
| competitors.ts | 18 | api |
| analytics.ts | 5 | api |
| actions.ts | 4 | api |

#### Admin панель
| Файл | Catch блоков | error_type |
|------|-------------|------------|
| adminUsers.ts | 3 | api |
| adminNotifications.ts | 4 | api |
| adminChat.ts | 6 | api |
| adminSettings.ts | 3 | api |
| adminAds.ts | 4 | api |
| adminErrors.ts | 4 | api |
| adminLeads.ts | 1 | api |
| adminStats.ts | 1 | api |

#### Прочие routes
| Файл | Catch блоков | error_type |
|------|-------------|------------|
| autopilot.ts | 3 | api |
| defaultSettings.ts | 4 | api |
| dialogs.ts | 7 | api |
| directionAdSets.ts | 5 | facebook |
| impersonation.ts | 2 | api |
| notifications.ts | 5 | api |
| onboarding.ts | 9 | api |
| briefingRoutes.ts | 6 | api |

---

### agent-brain/src/ (10 файлов)

| Файл | Catch блоков | error_type | Примечание |
|------|-------------|------------|------------|
| server.js | 3 | api/scoring | Основные endpoints |
| scoring.js | 2 | scoring | AI scoring агент |
| analyzerService.js | 3 | api | Анализ креативов |
| chatAssistant/index.js | 7 | api | Chat Assistant endpoints |
| chatAssistant/orchestrator/classifier.js | 1 | api | LLM классификация |
| chatAssistant/agents/BaseAgent.js | 2 | api | Базовый класс агентов |
| chatAssistant/toolHandlers.js | 1 | api | Выполнение инструментов |
| chatAssistant/contextGatherer.js | 1 | api | Сбор контекста |
| amocrmLeadsSyncCron.js | 2 | cron | Синхронизация лидов |
| lib/supabaseClient.js | 1 | api | Supabase wrapper |

---

### creative-generation-service/src/routes/ (4 файла)

| Файл | Catch блоков | error_type |
|------|-------------|------------|
| image.ts | 3 | creative_generation |
| carousel.ts | 6 | creative_generation |
| texts.ts | 4 | creative_generation |
| textCreatives.ts | 2 | creative_generation |

**Специальные helper-функции:**
- `logImageGenerationError(userId, error, action)`
- `logCarouselGenerationError(userId, error, action)`
- `logTextGenerationError(userId, error, action)`

---

## Схема БД

### Таблица error_logs

```sql
CREATE TABLE error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID REFERENCES user_accounts(id),
  error_type TEXT NOT NULL,
  error_code TEXT,
  raw_error TEXT NOT NULL,
  stack_trace TEXT,
  action TEXT,
  endpoint TEXT,
  request_data JSONB,
  severity TEXT DEFAULT 'warning',
  ai_explanation TEXT,           -- Генерируется GPT-4o-mini
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Индексы для быстрого поиска
CREATE INDEX idx_error_logs_user ON error_logs(user_account_id);
CREATE INDEX idx_error_logs_type ON error_logs(error_type);
CREATE INDEX idx_error_logs_severity ON error_logs(severity);
CREATE INDEX idx_error_logs_resolved ON error_logs(is_resolved);
CREATE INDEX idx_error_logs_created ON error_logs(created_at DESC);
```

---

## Мониторинг в админ-панели

### GET /admin/errors

Список ошибок с фильтрами:
- `severity` - фильтр по критичности
- `error_type` - фильтр по типу
- `is_resolved` - показать решённые/нерешённые
- `user_account_id` - ошибки конкретного пользователя

### PATCH /admin/errors/:id/resolve

Пометить ошибку как решённую:
```json
{
  "resolution_notes": "Исправлено в коммите abc123"
}
```

### GET /admin/stats/dashboard

Включает статистику ошибок:
- Количество нерешённых ошибок по severity
- Последние 5 ошибок с ai_explanation

---

## Важные принципы

### 1. Fire-and-forget
Логирование не должно блокировать основной flow:
```typescript
logErrorToAdmin({...}).catch(() => {}); // Игнорируем ошибки логирования
```

### 2. Timeout
HTTP запрос к endpoint имеет timeout 10 секунд:
```typescript
signal: AbortSignal.timeout(10000)
```

### 3. Не логируем в логирование
Если логирование ошибки само падает - просто выводим warn в console:
```typescript
} catch (err) {
  console.warn(`[errorLogger] Failed to send error log: ${err.message}`);
}
```

### 4. Severity правила
- **critical**: Webhooks (потеря лидов!), token expired, cron failures
- **warning**: Обычные API ошибки, генерация контента
- **info**: Некритичные ошибки

---

## Коммиты

| Коммит | Описание |
|--------|----------|
| 10c2052 | Итерация 1: базовая интеграция (~10% покрытие) |
| TBD | Итерация 2: полное покрытие (~174 catch блоков) |

---

## Следующие шаги

1. **Алерты в Telegram** - критические ошибки отправлять в Telegram канал
2. **Дашборд метрик** - графики ошибок по времени
3. **Auto-resolve** - автоматическое закрытие дублей
4. **Rate limiting** - защита от спама ошибок
