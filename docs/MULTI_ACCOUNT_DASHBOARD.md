# Multi-Account Dashboard

## Обзор

Multi-Account Dashboard — вводная страница для пользователей в мультиаккаунтном режиме. Показывает сводную статистику по всем рекламным аккаунтам и позволяет быстро переключаться между ними.

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           MultiAccountDashboard.tsx                    │  │
│  │  - Отображение сводной статистики                      │  │
│  │  - Таблица аккаунтов                                   │  │
│  │  - Навигация к детальному Dashboard                    │  │
│  └─────────────────────┬─────────────────────────────────┘  │
│                        │                                     │
│                        ▼                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              AppContext                                │  │
│  │  - adAccounts: список аккаунтов                        │  │
│  │  - currentAdAccountId: выбранный аккаунт               │  │
│  │  - multiAccountEnabled: флаг режима                    │  │
│  └─────────────────────┬─────────────────────────────────┘  │
└────────────────────────┼────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                       Backend                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │    GET /ad-accounts/:userAccountId/all-stats          │  │
│  │    - Получает список аккаунтов из БД                   │  │
│  │    - Параллельно запрашивает статистику Facebook       │  │
│  │    - Возвращает агрегированные данные                  │  │
│  └─────────────────────┬─────────────────────────────────┘  │
└────────────────────────┼────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       ┌────────────┐        ┌─────────────┐
       │  Supabase  │        │ Facebook    │
       │    (DB)    │        │ Graph API   │
       └────────────┘        └─────────────┘
```

## Компоненты

### Frontend

#### MultiAccountDashboard.tsx

**Расположение:** `services/frontend/src/pages/MultiAccountDashboard.tsx`

**Основные функции:**
- Отображение общей статистики (расходы, лиды, CPL)
- Таблица всех рекламных аккаунтов
- Переключение между аккаунтами
- Обновление данных

**State:**
```typescript
const [accountStats, setAccountStats] = useState<AccountStats[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [isRefreshing, setIsRefreshing] = useState(false);
```

**Типы данных:**
```typescript
interface AccountStats {
  id: string;
  name: string;
  page_picture_url: string | null;
  connection_status: 'pending' | 'connected' | 'error';
  is_active: boolean;
  stats: {
    spend: number;
    leads: number;
    impressions: number;
    clicks: number;
    cpl: number;
  } | null;
}

interface AggregatedStats {
  totalSpend: number;
  totalLeads: number;
  totalImpressions: number;
  avgCpl: number;
  accountCount: number;
  activeAccountCount: number;
}
```

**Ключевые особенности:**
1. **AbortController** — отмена запросов при размонтировании компонента
2. **Fallback данные** — при ошибке API показываются базовые данные аккаунтов
3. **Toast уведомления** — информирование пользователя об ошибках
4. **Логирование** — детальные логи для отладки

### Backend

#### GET /ad-accounts/:userAccountId/all-stats

**Расположение:** `services/agent-service/src/routes/adAccounts.ts`

**Параметры:**
| Параметр | Тип | Описание |
|----------|-----|----------|
| userAccountId | UUID | ID пользователя |
| since | YYYY-MM-DD | Начало периода (query) |
| until | YYYY-MM-DD | Конец периода (query) |

**Ответ:**
```json
{
  "accounts": [
    {
      "id": "uuid",
      "name": "Account Name",
      "page_picture_url": "https://...",
      "connection_status": "connected",
      "is_active": true,
      "stats": {
        "spend": 1234.56,
        "leads": 42,
        "impressions": 10000,
        "clicks": 500,
        "cpl": 29.39
      }
    }
  ]
}
```

**Особенности реализации:**
1. **Параллельные запросы** — статистика Facebook запрашивается параллельно для всех аккаунтов
2. **Таймаут** — 30 секунд на каждый запрос к Facebook API
3. **Валидация** — проверка UUID и формата дат
4. **Логирование** — детальные логи с метриками производительности

## Роутинг

### Маршруты

| Путь | Компонент | Описание |
|------|-----------|----------|
| `/accounts` | MultiAccountDashboard | Страница всех аккаунтов |
| `/` | Dashboard | Детальная статистика текущего аккаунта |

### Логика редиректа

При первом входе в мультиаккаунтном режиме:

```typescript
// Dashboard.tsx
useEffect(() => {
  if (multiAccountEnabled && contextAdAccounts.length > 0) {
    const hasVisitedDashboard = sessionStorage.getItem('hasVisitedDashboard');
    if (!hasVisitedDashboard) {
      sessionStorage.setItem('hasVisitedDashboard', 'true');
      navigate('/accounts', { replace: true });
    }
  }
}, [multiAccountEnabled, contextAdAccounts, navigate]);
```

**Поток:**
1. Пользователь логинится → попадает на `/`
2. Dashboard проверяет `hasVisitedDashboard` в sessionStorage
3. Если нет — редирект на `/accounts`
4. При logout sessionStorage очищается

## Боковое меню

Пункт "Все аккаунты" отображается только в мультиаккаунтном режиме:

```typescript
// AppSidebar.tsx
const showAccountsPage = multiAccountEnabled && adAccounts.length > 0;
```

## Логирование

### Frontend

```typescript
const logger = {
  info: (message: string, data?: Record<string, unknown>) => {
    console.log(`[MultiAccountDashboard] ${message}`, data);
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(`[MultiAccountDashboard] ${message}`, data);
  },
  error: (message: string, error?: unknown, data?: Record<string, unknown>) => {
    console.error(`[MultiAccountDashboard] ${message}`, { error, ...data });
  },
  debug: (message: string, data?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[MultiAccountDashboard] ${message}`, data);
    }
  },
};
```

**Логируемые события:**
- Начало загрузки данных
- Ответ API (статус, время)
- Выбор аккаунта
- Ошибки

### Backend

Использует `createLogger` из `../lib/logger.js`:

```typescript
log.info({ userAccountId, accountCount }, '[all-stats] Ad accounts fetched');
log.debug({ accountDbId, stats }, 'Facebook stats fetched successfully');
log.warn({ accountDbId, error }, 'Failed to fetch Facebook stats');
log.error({ userAccountId, error }, '[all-stats] Unexpected error');
```

**Логируемые метрики:**
- `durationMs` — время выполнения запроса
- `requestId` — ID запроса Fastify
- `accountCount` — количество аккаунтов
- `accountsWithStats` — количество аккаунтов со статистикой

## Обработка ошибок

### Frontend

1. **Ошибка сети** — показывается banner с предупреждением
2. **Ошибка API** — fallback на базовые данные аккаунтов (без статистики)
3. **AbortError** — игнорируется (при размонтировании)

### Backend

1. **Невалидный UUID** — 400 Bad Request
2. **Невалидные даты** — 400 Bad Request с деталями
3. **Ошибка БД** — 500 + логирование в admin errors
4. **Ошибка Facebook API** — продолжение без статистики для этого аккаунта

## Тестирование

### Ручное тестирование

1. **Первый вход:**
   - Залогиниться в мультиаккаунтном режиме
   - Проверить редирект на `/accounts`

2. **Переключение аккаунтов:**
   - Кликнуть на аккаунт в таблице
   - Проверить переход на Dashboard
   - Проверить что данные загружаются для выбранного аккаунта

3. **Обновление данных:**
   - Нажать кнопку refresh
   - Проверить toast уведомление
   - Проверить обновление данных

4. **Обработка ошибок:**
   - Отключить сеть
   - Проверить fallback данные и error banner

### Проверка логов

**Frontend (DevTools Console):**
```
[MultiAccountDashboard] Starting to load account stats {accountsCount: 3, dateRange: {...}}
[MultiAccountDashboard] API response received {status: 200, ok: true, durationMs: 450}
[MultiAccountDashboard] Stats loaded successfully {accountsCount: 3, accountsWithStats: 2}
```

**Backend (server logs):**
```
[all-stats] Starting request {userAccountId: "...", dateRange: {...}}
[all-stats] Ad accounts fetched from database {accountCount: 3}
[all-stats] Request completed successfully {durationMs: 1250, accountsWithStats: 2}
```

## Производительность

### Оптимизации

1. **Параллельные запросы** — статистика Facebook запрашивается одновременно для всех аккаунтов
2. **AbortController** — предотвращение memory leaks
3. **useMemo** — кэширование вычисления агрегированной статистики
4. **useCallback** — мемоизация обработчиков событий

### Метрики

Типичное время ответа API:
- 1-2 аккаунта: 300-500ms
- 3-5 аккаунтов: 500-1500ms

## Безопасность

1. **Валидация UUID** — на backend перед запросом к БД
2. **Валидация дат** — regex проверка формата YYYY-MM-DD
3. **Таймаут** — 30 секунд на запросы к Facebook API
4. **Маскирование токенов** — access_token не логируется

## Связанные файлы

```
services/frontend/src/
├── pages/
│   ├── MultiAccountDashboard.tsx  # Основной компонент
│   └── Dashboard.tsx              # Редирект логика
├── components/
│   ├── AppSidebar.tsx             # Пункт меню
│   └── Header.tsx                 # Очистка session при logout
└── App.tsx                        # Route /accounts

services/agent-service/src/
└── routes/
    └── adAccounts.ts              # API endpoint all-stats
```

## Changelog

### v1.0.0 (2024-12-29)
- Создана страница MultiAccountDashboard
- Добавлен API endpoint `/ad-accounts/:userAccountId/all-stats`
- Реализован редирект при первом входе
- Добавлен пункт меню "Все аккаунты"

### v1.1.0 (2024-12-29)
- Добавлен AbortController для отмены запросов
- Параллельные запросы к Facebook API
- Улучшенное логирование с метриками
- Валидация параметров
- Toast уведомления об ошибках
- Поддержка dark mode для badges
