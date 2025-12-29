# A/B Тестирование Креативов

## Обзор

Функция A/B тестирования позволяет сравнивать эффективность нескольких креативов (изображений) одновременно с гарантированно равным распределением показов.

### Ключевые особенности:
- Выбор от 2 до 5 креативов для теста
- Каждый креатив получает отдельный AdSet (гарантия равных показов)
- Настраиваемый бюджет ($5-$100) и лимит показов (100-10000)
- Автоматический мониторинг и завершение теста
- Анализ результатов и сохранение инсайтов
- Рейтинг лучших офферов и образов

---

## Архитектура

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│  Agent Service   │────▶│  Facebook API   │
│   (React)       │     │   (Fastify)      │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │
        │                       ▼
        │               ┌──────────────────┐
        │               │   Supabase DB    │
        │               │  - creative_ab_  │
        │               │    tests         │
        │               │  - creative_ab_  │
        │               │    test_items    │
        │               │  - conversation_ │
        │               │    insights      │
        │               └──────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│   Gemini Service (OCR + Image Description)  │
└─────────────────────────────────────────────┘
```

---

## База данных

### Таблица `creative_ab_tests`

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | uuid | PK |
| user_id | uuid | ID пользователя |
| account_id | uuid | ID рекламного аккаунта |
| direction_id | uuid | ID направления |
| campaign_id | text | ID кампании в Facebook |
| status | text | pending / running / completed / failed / cancelled |
| total_budget_cents | int | Общий бюджет в центах |
| impressions_per_creative | int | Лимит показов на креатив |
| creatives_count | int | Количество креативов |
| winner_creative_id | uuid | ID победившего креатива |
| analysis_json | jsonb | Результаты анализа |
| started_at | timestamp | Время старта |
| completed_at | timestamp | Время завершения |

### Таблица `creative_ab_test_items`

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | uuid | PK |
| test_id | uuid | FK → creative_ab_tests |
| user_creative_id | uuid | FK → user_creatives |
| adset_id | text | ID AdSet в Facebook |
| ad_id | text | ID Ad в Facebook |
| budget_cents | int | Бюджет для этого креатива |
| impressions_limit | int | Лимит показов |
| impressions | int | Текущие показы |
| reach | int | Охват |
| clicks | int | Клики |
| link_clicks | int | Клики по ссылке |
| ctr | float | CTR % |
| link_ctr | float | Link CTR % |
| leads | int | Лиды |
| spend_cents | int | Потрачено в центах |
| cpm_cents | int | CPM в центах |
| cpc_cents | int | CPC в центах |
| cpl_cents | int | CPL в центах |
| rank | int | Место в рейтинге |
| extracted_offer_text | text | Распознанный текст оффера (OCR) |
| extracted_image_description | text | Описание образа (Vision AI) |

---

## API Endpoints

### POST `/creative-ab-test/start`

Запускает новый A/B тест.

**Request Body:**
```json
{
  "creative_ids": ["uuid1", "uuid2", "uuid3"],
  "user_id": "user-uuid",
  "account_id": "account-uuid",
  "direction_id": "direction-uuid",
  "total_budget_cents": 2000,
  "total_impressions": 1000
}
```

**Response:**
```json
{
  "success": true,
  "test_id": "test-uuid",
  "campaign_id": "fb-campaign-id",
  "items": [
    {
      "id": "item-uuid",
      "user_creative_id": "creative-uuid",
      "adset_id": "fb-adset-id",
      "ad_id": "fb-ad-id",
      "impressions_limit": 333
    }
  ],
  "budget_per_creative_cents": 666,
  "impressions_per_creative": 333,
  "message": "A/B test started with 3 creatives..."
}
```

### GET `/creative-ab-test/:test_id?user_id=xxx`

Получает статус и результаты теста.

### GET `/creative-ab-test/status`

Получает все активные тесты (для cron).

### POST `/creative-ab-test/check/:test_id`

Проверяет и обновляет метрики теста (вызывается cron).

### DELETE `/creative-ab-test/:test_id?user_id=xxx`

Останавливает и удаляет тест.

### GET `/creative-ab-test/insights?user_id=xxx&category=offer_text`

Получает рейтинг инсайтов (офферы и образы).

---

## Workflow

### 1. Запуск теста (`workflowStartAbTest`)

```
1. Валидация параметров (2-5 креативов, один direction)
2. Получение credentials (access_token, page_id, etc.)
3. Определение Facebook parameters по objective:
   - whatsapp → OUTCOME_ENGAGEMENT / CONVERSATIONS
   - instagram_traffic → OUTCOME_TRAFFIC / LINK_CLICKS
   - site_leads → OUTCOME_LEADS / OFFSITE_CONVERSIONS
   - lead_forms → OUTCOME_LEADS / LEAD_GENERATION
4. Создание Campaign в Facebook
5. Для каждого креатива:
   a. Создание AdSet с individual budget
   b. Создание Ad
   c. Сохранение маппинга
   d. Создание записи в creative_ab_test_items
6. Возврат результата с IDs
```

### 2. Мониторинг (Cron каждые 5 минут)

```
1. Получение всех running тестов (max 10 за раз)
2. Для каждого теста:
   a. Получение insights по каждому ad
   b. Обновление метрик в БД
   c. Проверка условия завершения:
      - totalImpressions >= totalLimit
   d. Если завершён:
      - Пауза всех AdSets
      - Пауза Campaign
      - Анализ результатов
```

### 3. Анализ результатов (`analyzeAbTestResults`)

```
1. Получение всех items с метриками
2. Ранжирование:
   - Если есть leads → по CPL (меньше = лучше)
   - Иначе → по CTR (больше = лучше)
3. Присвоение рангов (1 = победитель)
4. Формирование analysis_json
5. Обновление статуса теста → completed
6. Сохранение инсайтов:
   - offer_text (OCR текст)
   - creative_image (описание образа)
```

---

## Логирование

Все логи используют префиксы для фильтрации:

| Префикс | Компонент |
|---------|-----------|
| `[A/B Test]` | Routes (API endpoints) |
| `[Workflow]` | Workflow functions |
| `[Analyze]` | Analysis functions |
| `[Insights]` | Metrics fetching |
| `[A/B Cron]` | Cron job |

### Пример логов успешного теста:

```
[A/B Test] Starting A/B test request { user_id, creative_count: 3, total_budget_cents: 2000 }
[Workflow] Starting A/B test workflow { creatives_count: 3, budget_per_creative: 666 }
[Workflow] Creating campaign { campaign_name, fb_objective }
[Workflow] Campaign created successfully { campaign_id, elapsed_ms: 1234 }
[Workflow] Creating adset for creative { creative_id, item_index: 1 }
[Workflow] AdSet created { adset_id, elapsed_ms: 567 }
[Workflow] Ad created { ad_id, elapsed_ms: 890 }
[Workflow] Item created and saved { item_index: 1 }
... (повторяется для каждого креатива)
[Workflow] A/B test workflow completed { test_id, items_count: 3, elapsed_ms: 5678 }
[A/B Test] A/B test started successfully { test_id, campaign_id, elapsed_ms: 6000 }
```

---

## Обработка ошибок

### Rollback при ошибках

Если создание AdSet или Ad не удаётся:
1. Паузятся все ранее созданные AdSets
2. Паузится Campaign
3. Возвращается ошибка с деталями

### Retry логика

- Facebook API: без retry (ошибки обычно требуют ручного вмешательства)
- Database: стандартный retry Supabase client

### Мьютекс в Cron

Используется `isProcessing` flag для предотвращения параллельного выполнения:

```typescript
let isProcessing = false;

cron.schedule('*/5 * * * *', async () => {
  if (isProcessing) {
    app.log.warn('Previous run still in progress, skipping...');
    return;
  }
  isProcessing = true;
  try {
    // ... processing
  } finally {
    isProcessing = false;
  }
});
```

---

## Frontend

### Компоненты

1. **AbTestInsights** (`/components/AbTestInsights.tsx`)
   - Отображает активные тесты с прогрессом
   - Показывает рейтинг офферов и образов
   - Три вкладки: Тесты / Офферы / Образы

2. **Creatives Page** (`/pages/Creatives.tsx`)
   - Кнопка "A/B тест" (появляется при выборе 2-5 картинок)
   - Модалка запуска с настройкой бюджета
   - Модалка результатов

### API Client

```typescript
// services/creativeAbTestApi.ts

creativeAbTestApi.startTest({
  user_account_id: "...",
  direction_id: "...",
  creative_ids: ["...", "..."],
  total_budget_cents: 2000
});

creativeAbTestApi.getTest(testId);
creativeAbTestApi.stopTest(testId);
creativeAbTestApi.getInsights('offer_text');
creativeAbTestApi.getActiveTests();
```

---

## Конфигурация

### Константы (routes/creativeAbTest.ts)

```typescript
const DEFAULT_TOTAL_BUDGET_CENTS = 2000;  // $20
const DEFAULT_TOTAL_IMPRESSIONS = 1000;
const MIN_BUDGET_CENTS = 500;   // $5
const MAX_BUDGET_CENTS = 10000; // $100
const MIN_CREATIVES = 2;
const MAX_CREATIVES = 5;
```

### Cron (cron/creativeAbTestChecker.ts)

```typescript
const MAX_TESTS_PER_RUN = 10;       // Макс тестов за запуск
const CRON_INTERVAL = '*/5 * * * *'; // Каждые 5 минут
```

---

## Миграция

Файл: `migrations/133_creative_ab_tests.sql`

```sql
-- Добавляем поля для OCR и описания в user_creatives
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS ocr_text TEXT,
ADD COLUMN IF NOT EXISTS image_description TEXT;

-- Создаём таблицы A/B тестов
CREATE TABLE creative_ab_tests (...);
CREATE TABLE creative_ab_test_items (...);

-- Расширяем типы для conversation_insights
ALTER TABLE conversation_insights
DROP CONSTRAINT IF EXISTS conversation_insights_category_check;

ALTER TABLE conversation_insights
ADD CONSTRAINT conversation_insights_category_check
CHECK (category IN ('general', 'pain_point', 'objection',
                   'competitor_mention', 'offer_text', 'creative_image'));
```

---

## Интеграция с Gemini (OCR + Image Description)

При загрузке изображения автоматически выполняется:

1. **OCR** - распознавание текста на изображении (оффер)
2. **Image Description** - описание визуального образа

### Endpoints (creative-generation-service)

```
POST /image/describe     - только описание образа
POST /image/analyze-creative - OCR + описание (параллельно)
```

### Асинхронный анализ

После успешной загрузки картинки в `agent-service/routes/image.ts`:

```typescript
// Запускаем анализ асинхронно (не блокируя ответ)
analyzeImageAsync(record.id, imageUrl, userId);
```

---

## Пример использования

### 1. Выбор креативов

1. Зайти на страницу Креативы
2. Отметить чекбоксами 2-5 изображений одного направления
3. Нажать кнопку "A/B тест"

### 2. Настройка теста

1. Указать бюджет (по умолчанию $20)
2. Проверить выбранные креативы
3. Нажать "Запустить A/B тест"

### 3. Мониторинг

- Прогресс отображается в блоке "A/B Тесты"
- Показывается % от лимита показов
- Автоматическое обновление каждые 5 минут

### 4. Результаты

После завершения:
- Победитель отмечается трофеем
- Результаты сохраняются в рейтинг инсайтов
- Офферы и образы можно просмотреть во вкладках

---

## Troubleshooting

### Тест не стартует

1. Проверить что все креативы из одного направления
2. Проверить что креативы имеют статус 'ready'
3. Проверить Facebook access token

### Тест не завершается

1. Проверить логи cron: `[A/B Cron]`
2. Убедиться что impressions растут
3. Проверить что campaign/adsets не на паузе в Facebook

### Нет инсайтов

1. Проверить что у креативов есть ocr_text или image_description
2. Проверить логи анализа: `[Analyze]`
3. Проверить таблицу conversation_insights
