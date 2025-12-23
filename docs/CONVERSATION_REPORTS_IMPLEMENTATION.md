# Реализация отчётов по перепискам (Conversation Reports)

## Обзор

Реализована функциональность ежедневных отчётов по WhatsApp перепискам с LLM-анализом, аналогично существующим утренним отчётам Agent Brain по рекламе.

**Дата реализации:** 21 декабря 2024
**Ветка:** `claude/add-conversation-report-WkWgk`

---

## Архитектура решения

```
┌─────────────────────┐     Cron 9:30 AM      ┌─────────────────────┐
│    Agent Brain      │ ──────────────────────▶│    CRM Backend      │
│    (server.js)      │   POST /generate-all   │  (conversationReports.ts)
└─────────────────────┘                        └──────────┬──────────┘
                                                          │
                                                          ▼
                                               ┌─────────────────────┐
                                               │  generateConversation│
                                               │  Report.ts           │
                                               └──────────┬──────────┘
                                                          │
                      ┌───────────────────────────────────┼───────────────────────────────────┐
                      │                                   │                                   │
                      ▼                                   ▼                                   ▼
           ┌─────────────────┐                 ┌─────────────────┐                 ┌─────────────────┐
           │   Supabase      │                 │   OpenAI        │                 │   Telegram      │
           │   (dialogs,     │                 │   GPT-4o-mini   │                 │   (уведомления) │
           │   messages)     │                 │   (анализ)      │                 │                 │
           └─────────────────┘                 └─────────────────┘                 └─────────────────┘
                      │
                      ▼
           ┌─────────────────┐
           │ conversation_   │
           │ reports (новая) │
           └─────────────────┘
                      │
                      ▼
           ┌─────────────────────────────────────────────────────────────────┐
           │                        Frontend                                  │
           │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
           │  │ ConversationRe- │  │ useConversation │  │ conversationRe- │  │
           │  │ ports.tsx       │◀─│ Reports.ts      │◀─│ portService.ts  │  │
           │  │ (страница)      │  │ (хук)           │  │ (API клиент)    │  │
           │  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
           └─────────────────────────────────────────────────────────────────┘
```

---

## Созданные файлы

### 1. База данных

#### `migrations/106_conversation_reports.sql`

Миграция для создания таблицы `conversation_reports`:

```sql
CREATE TABLE conversation_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id),
  report_date DATE NOT NULL,

  -- Метрики
  total_dialogs INTEGER DEFAULT 0,
  new_dialogs INTEGER DEFAULT 0,
  active_dialogs INTEGER DEFAULT 0,
  total_incoming_messages INTEGER DEFAULT 0,
  total_outgoing_messages INTEGER DEFAULT 0,
  avg_response_time_minutes DECIMAL(10,2),

  -- Распределение по интересу
  interest_distribution JSONB DEFAULT '{}',

  -- LLM анализ
  llm_insights TEXT,
  key_objections JSONB DEFAULT '[]',
  rejection_reasons JSONB DEFAULT '[]',
  recommendations JSONB DEFAULT '[]',
  conversion_analysis TEXT,

  -- Сырые данные
  raw_metrics JSONB DEFAULT '{}',

  -- Метаданные
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_account_id, report_date)
);
```

**Индексы:**
- `idx_conversation_reports_user_date` — для быстрого поиска по пользователю и дате
- `idx_conversation_reports_date` — для фильтрации по дате

**RLS политики:**
- Пользователи видят только свои отчёты

---

### 2. Backend (CRM)

#### `services/crm-backend/src/scripts/generateConversationReport.ts`

Основной скрипт генерации отчётов:

**Функции:**
- `generateConversationReport({ userAccountId, date })` — генерация отчёта для одного пользователя
- `generateAllConversationReports(date)` — генерация отчётов для всех активных пользователей

**Логика работы:**
1. Определяет временной диапазон (предыдущие 24 часа: `startOfDay` — `endOfDay`)
2. Запускает `analyzeDialogs()` для обновления данных в CRM (анализ ВСЕХ новых контактов)
3. Получает все диалоги пользователя из `dialog_analysis`
4. Фильтрует диалоги за период:
   - `activeDialogs` — диалоги с `last_message` в периоде (активные вчера)
   - `newDialogs` — диалоги с `first_message` в периоде (новые вчера)
5. Рассчитывает метрики только по `activeDialogs`:
   - Входящие/исходящие сообщения
   - Среднее время ответа (в секундах)
   - Распределение по уровню интереса (hot/warm/cold)
   - Возражения
6. Формирует промпт для LLM с данными переписок
7. Вызывает OpenAI GPT-4o-mini для анализа
8. Сохраняет отчёт в базу данных
9. Отправляет отчёт в Telegram (если есть `telegram_id`)

**Важно о метриках:**

| Метрика | Фильтрация по | Описание |
|---------|---------------|----------|
| `active_dialogs` | `last_message` | Диалоги с последним сообщением в периоде |
| `new_dialogs` | `first_message` | Диалоги, которые НАЧАЛИСЬ в периоде |
| `total_dialogs` | = `active_dialogs` | Для отчёта считаем только активные |

**Примечание:** `analyzeDialogs()` анализирует ВСЕ новые контакты из WhatsApp (которых ещё нет в CRM), независимо от даты. Это обновляет базу данных актуальными данными. Количество проанализированных контактов в логах может быть больше, чем `active_dialogs` в отчёте — это нормально.

**Структура LLM ответа:**
```typescript
interface LLMAnalysisResult {
  summary: string;           // Краткое резюме дня
  key_insights: string[];    // Ключевые инсайты
  objections: string[];      // Частые возражения
  rejection_reasons: string[]; // Причины отказов
  recommendations: string[]; // Рекомендации
  conversion_analysis: string; // Анализ конверсий
}
```

#### `services/crm-backend/src/routes/conversationReports.ts`

API маршруты:

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/conversation-reports` | Список отчётов с пагинацией |
| GET | `/conversation-reports/latest` | Последний отчёт пользователя |
| GET | `/conversation-reports/stats` | Агрегированная статистика за период |
| GET | `/conversation-reports/:id` | Конкретный отчёт по ID |
| POST | `/conversation-reports/generate` | Генерация отчёта для пользователя |
| POST | `/conversation-reports/generate-all` | Генерация для всех (admin) |

**Важно:** Порядок маршрутов критичен! `/latest` и `/stats` должны быть объявлены ДО `/:id`, иначе параметр `:id` захватит эти пути.

#### `services/crm-backend/src/server.ts`

Добавлена регистрация маршрутов:
```typescript
import { conversationReportsRoutes } from './routes/conversationReports.js';
// ...
app.register(conversationReportsRoutes);
```

---

### 3. Agent Brain (Cron)

#### `services/agent-brain/src/server.js`

Добавлен cron job для автоматической генерации отчётов:

```javascript
const CONVERSATION_REPORT_CRON_SCHEDULE = '30 9 * * *'; // 9:30 AM Almaty

cron.schedule(CONVERSATION_REPORT_CRON_SCHEDULE, async () => {
  console.log('Starting daily conversation reports generation...');

  try {
    const response = await fetch(`${CRM_BACKEND_URL}/conversation-reports/generate-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey: process.env.ADMIN_API_KEY })
    });

    const result = await response.json();
    console.log('Conversation reports generated:', result);

    // Уведомление в Telegram при ошибках
    if (!result.success || result.failed > 0) {
      await notifyTelegram(`Conversation Reports: ${result.successful} успешно, ${result.failed} ошибок`);
    }
  } catch (error) {
    console.error('Failed to generate conversation reports:', error);
    await notifyTelegram(`Ошибка генерации отчётов переписок: ${error.message}`);
  }
}, { timezone: 'Asia/Almaty' });
```

---

### 4. Frontend

#### `services/frontend/src/types/conversationReport.ts`

TypeScript типы:

```typescript
export interface ConversationReport {
  id: string;
  user_account_id: string;
  report_date: string;
  total_dialogs: number;
  new_dialogs: number;
  active_dialogs: number;
  total_incoming_messages: number;
  total_outgoing_messages: number;
  avg_response_time_minutes: number | null;
  interest_distribution: {
    hot?: number;
    warm?: number;
    cold?: number;
  };
  llm_insights: string | null;
  key_objections: string[];
  rejection_reasons: string[];
  recommendations: string[];
  conversion_analysis: string | null;
  generated_at: string;
}

export interface ConversationReportStats {
  period_days: number;
  reports_count: number;
  total_dialogs: number;
  total_new_dialogs: number;
  total_active_dialogs: number;
  total_incoming_messages: number;
  total_outgoing_messages: number;
  avg_response_time: number | null;
  interest_trends: {
    hot: number[];
    warm: number[];
    cold: number[];
  };
  dates: string[];
}
```

#### `services/frontend/src/services/conversationReportService.ts`

API клиент:

```typescript
export const conversationReportService = {
  getReports(userAccountId, limit, offset),
  getLatestReport(userAccountId),
  getReportById(id, userAccountId),
  getStats(userAccountId, days),
  generateReport(userAccountId, date),
};
```

#### `services/frontend/src/hooks/useConversationReports.ts`

React хук для управления данными:

```typescript
export function useConversationReports(options: UseConversationReportsOptions) {
  // Состояние
  const [reports, setReports] = useState<ConversationReport[]>([]);
  const [latestReport, setLatestReport] = useState<ConversationReport | null>(null);
  const [stats, setStats] = useState<ConversationReportStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Методы
  const fetchReports = useCallback(...);
  const fetchLatestReport = useCallback(...);
  const fetchStats = useCallback(...);
  const generateReport = useCallback(...);

  // Автозагрузка при монтировании
  useEffect(() => {
    if (autoFetch && userAccountId) {
      fetchReports();
      fetchLatestReport();
      fetchStats();
    }
  }, [autoFetch, userAccountId]);

  return { reports, latestReport, stats, loading, error, ... };
}
```

#### `services/frontend/src/components/reports/`

Компоненты:

1. **ConversationReportCard.tsx** — карточка отчёта в списке
2. **ConversationReportDetail.tsx** — детальный просмотр отчёта
3. **ConversationReportsList.tsx** — список с пагинацией
4. **index.ts** — экспорты

#### `services/frontend/src/pages/ConversationReports.tsx`

Главная страница отчётов:
- Отображает последний отчёт
- Список всех отчётов с пагинацией
- Статистика за период
- Кнопка ручной генерации

#### `services/frontend/src/App.tsx`

Добавлен маршрут:
```tsx
<Route path="/conversation-reports" element={<ConversationReports />} />
```

#### `services/frontend/src/components/AppSidebar.tsx`

Добавлен пункт меню:
```tsx
{
  title: "Отчёты переписок",
  url: "/conversation-reports",
  icon: MessageSquareText,
}
```

---

## Исправленные проблемы

### 1. Порядок маршрутов в Fastify

**Проблема:** Маршрут `/:id` был объявлен перед `/latest` и `/stats`, захватывая их как значение параметра `id`.

**Решение:** Переупорядочены маршруты:
1. `/conversation-reports` (базовый)
2. `/conversation-reports/latest` (специфический)
3. `/conversation-reports/stats` (специфический)
4. `/conversation-reports/:id` (динамический — последний)

### 2. Бесконечный цикл useEffect

**Проблема:** В зависимостях useEffect были callback-функции, которые пересоздавались при каждом рендере.

**Решение:** Зависимости изменены на примитивы:
```typescript
useEffect(() => {
  if (autoFetch && userAccountId) {
    fetchReports();
    fetchLatestReport();
    fetchStats();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [autoFetch, userAccountId]);
```

### 3. Неправильный подсчёт `new_dialogs` (23 декабря 2024)

**Проблема:** `new_dialogs` считался по `created_at` (дата создания записи в БД), а не по `first_message` (дата первого сообщения от клиента).

При массовом анализе диалогов все записи получали одинаковый `created_at`, что приводило к завышенному числу "новых" диалогов.

**Было:**
```typescript
const newDialogs = allDialogs.filter(d => {
  const created = new Date(d.created_at);  // ← дата создания ЗАПИСИ
  return created >= startOfDay && created <= endOfDay;
});
```

**Решение:**
```typescript
const newDialogs = allDialogs.filter(d => {
  const firstMsg = new Date(d.first_message);  // ← дата ПЕРВОГО сообщения
  return firstMsg >= startOfDay && firstMsg <= endOfDay;
});
```

Теперь `new_dialogs` показывает диалоги, которые реально НАЧАЛИСЬ в указанный период.

### 4. Лимит 100 диалогов для анализа (22 декабря 2024)

**Проблема:** `analyzeDialogs()` имел жёсткий лимит `maxDialogs: 100`, что ограничивало количество анализируемых диалогов.

**Решение:** Лимит убран. Теперь анализируются все новые контакты, а фильтрация по периоду происходит после анализа через `activeDialogs`.

---

## Следующие шаги

### Обязательные

1. **Применить миграцию в Supabase**
   ```bash
   # На production сервере или через Supabase Dashboard
   psql $DATABASE_URL -f migrations/106_conversation_reports.sql
   ```

2. **Добавить переменные окружения** (если отсутствуют)
   ```env
   # CRM Backend
   OPENAI_API_KEY=sk-...
   ADMIN_API_KEY=your-admin-key

   # Agent Brain
   CRM_BACKEND_URL=https://your-crm-backend.com
   ADMIN_API_KEY=your-admin-key
   ```

3. **Задеплоить сервисы**
   - `services/crm-backend` — новые API endpoints
   - `services/agent-brain` — cron job
   - `services/frontend` — новая страница

4. **Проверить работу cron**
   - Отчёты должны генерироваться в 9:30 по времени Алматы
   - Проверить логи Agent Brain

### Рекомендуемые

5. **Настроить Telegram уведомления**
   - Убедиться, что `MONITORING_BOT_TOKEN` и `MONITORING_CHAT_ID` настроены
   - При ошибках генерации будут приходить уведомления

6. **Добавить тесты**
   ```typescript
   // services/crm-backend/src/scripts/__tests__/generateConversationReport.test.ts
   describe('generateConversationReport', () => {
     it('should generate report for user with dialogs', async () => {...});
     it('should handle user with no dialogs', async () => {...});
     it('should calculate correct metrics', async () => {...});
   });
   ```

7. **Мониторинг**
   - Добавить метрики времени генерации отчётов
   - Отслеживать количество ошибок LLM
   - Мониторить размер таблицы `conversation_reports`

8. **Оптимизация**
   - При большом количестве диалогов рассмотреть batch processing
   - Кэширование статистики
   - Архивация старых отчётов

### Возможные улучшения

9. **Экспорт отчётов**
   - PDF генерация
   - Excel export
   - Отправка на email

10. **Расширенная аналитика**
    - Сравнение с предыдущими периодами
    - Графики трендов
    - Прогнозы на основе исторических данных

11. **Настройки пользователя**
    - Выбор времени генерации отчёта
    - Настройка содержимого отчёта
    - Уведомления о готовности отчёта

12. **Интеграции**
    - Отправка отчёта в Slack/Telegram
    - Интеграция с Google Sheets
    - Webhook для внешних систем

---

## Тестирование

### Ручное тестирование API

```bash
# Генерация отчёта
curl -X POST "http://localhost:8083/conversation-reports/generate" \
  -H "Content-Type: application/json" \
  -d '{"userAccountId": "YOUR_USER_ACCOUNT_ID"}'

# Получение последнего отчёта
curl "http://localhost:8083/conversation-reports/latest?userAccountId=YOUR_USER_ACCOUNT_ID"

# Получение списка отчётов
curl "http://localhost:8083/conversation-reports?userAccountId=YOUR_USER_ACCOUNT_ID&limit=10"

# Получение статистики
curl "http://localhost:8083/conversation-reports/stats?userAccountId=YOUR_USER_ACCOUNT_ID&days=7"

# Генерация для всех пользователей (admin)
curl -X POST "http://localhost:8083/conversation-reports/generate-all" \
  -H "Content-Type: application/json" \
  -d '{"adminKey": "YOUR_ADMIN_KEY"}'
```

### Проверка Frontend

1. Открыть приложение
2. Перейти в боковом меню на "Отчёты переписок"
3. Проверить отображение списка отчётов
4. Кликнуть на отчёт для детального просмотра
5. Проверить кнопку "Сгенерировать отчёт"

---

## Коммиты

| Хеш | Сообщение |
|-----|-----------|
| `da49923` | feat: add daily conversation reports with LLM analytics |
| `e6dff4f` | fix: исправление порядка маршрутов и useEffect зависимостей |
| `1c1a1f2` | fix: count new_dialogs by first_message instead of created_at |

---

## Связанные файлы

- `migrations/106_conversation_reports.sql`
- `services/crm-backend/src/scripts/generateConversationReport.ts`
- `services/crm-backend/src/routes/conversationReports.ts`
- `services/crm-backend/src/server.ts`
- `services/agent-brain/src/server.js`
- `services/frontend/src/types/conversationReport.ts`
- `services/frontend/src/services/conversationReportService.ts`
- `services/frontend/src/hooks/useConversationReports.ts`
- `services/frontend/src/components/reports/*`
- `services/frontend/src/pages/ConversationReports.tsx`
- `services/frontend/src/App.tsx`
- `services/frontend/src/components/AppSidebar.tsx`
