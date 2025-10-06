# 🎨 Система быстрого тестирования креативов

## 📅 Дата: 6 октября 2025

---

## 🎯 НАЗНАЧЕНИЕ

Система для быстрого A/B тестирования видео-креативов:
- Запуск теста с фронта по кнопке "Быстрый тест"
- Автоматическое отключение при 1000 показов (Facebook Auto Rule)
- LLM анализ результатов с транскрибацией
- Рекомендации по улучшению текста видео
- Отображение на фронте через Supabase Realtime

---

## 📊 АРХИТЕКТУРА

### 0. Микросервисы

```
1. agent-service:8080 — Запуск тестов, обновление метрик
2. analyzer-service:7081 — ОТДЕЛЬНЫЙ LLM анализатор (НЕ трогает основной Brain!)
3. agent-brain:7080 — Основной Brain Agent (НЕ ЗАТРОНУТ)
```

**Важно:** Creative Analyzer — это ОТДЕЛЬНЫЙ микросервис с ОТДЕЛЬНЫМ промптом!
Он не связан с основным Brain Agent и его промптом.

### 1. База данных

**Таблица `creative_tests`:**
```sql
- id UUID
- user_creative_id UUID (UNIQUE - один креатив = один тест)
- user_id UUID
- campaign_id, adset_id, ad_id, rule_id TEXT
- status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

-- Метрики
- impressions, reach, frequency
- clicks, link_clicks, ctr, link_ctr
- leads, spend_cents, cpm_cents, cpc_cents, cpl_cents
- video_views, video_views_25/50/75/95_percent
- video_avg_watch_time_sec

-- LLM Analysis
- llm_score (0-100)
- llm_verdict: 'excellent' | 'good' | 'average' | 'poor'
- llm_reasoning TEXT
- llm_video_analysis TEXT
- llm_text_recommendations TEXT
- transcript_match_quality: 'high' | 'medium' | 'low'
- transcript_suggestions JSONB
```

### 2. Компоненты

```
ФРОНТ → Webhook POST /api/creative-test/start (agent-service:8080)
           ↓
     Agent-Service создает:
       - Campaign "Test — Creative #xxx"
       - AdSet ($20/день)
       - Ad с креативом
       - Facebook Auto Rule (stop at 1000 impressions)
       - Запись в creative_tests (status='running')
           ↓
     Cron каждые 5 минут проверяет:
       GET /api/creative-test/status (agent-service)
       POST /api/creative-test/check/:test_id (agent-service)
           ↓
     Если impressions >= 1000:
       Agent-Service → POST /api/analyzer/analyze-test (analyzer:7081)
           ↓
     Analyzer Service (ОТДЕЛЬНЫЙ микросервис):
       1. Читает метрики из creative_tests
       2. Читает транскрибацию из creative_transcripts
       3. Отправляет в OpenAI LLM (свой промпт!)
       4. Получает анализ (score, verdict, recommendations)
       5. Сохраняет в creative_tests (status='completed')
           ↓
     ФРОНТ читает напрямую из Supabase (Realtime)
```

**ВАЖНО:** Analyzer Service = ОТДЕЛЬНЫЙ сервис, ОТДЕЛЬНЫЙ промпт, ОТДЕЛЬНЫЙ порт!
Основной Brain Agent (7080) не затронут!

---

## 📝 API ЭНДПОИНТЫ

### 1. Запуск теста

```http
POST /api/creative-test/start

Request:
{
  "user_creative_id": "uuid",
  "user_id": "uuid"
}

Response:
{
  "success": true,
  "test_id": "uuid",
  "campaign_id": "123",
  "adset_id": "456",
  "ad_id": "789",
  "rule_id": "rule_123",
  "message": "Creative test started. Budget: $20/day, Target: 1000 impressions"
}
```

### 2. Получение результатов

```http
GET /api/creative-test/results/:user_creative_id

Response:
{
  "success": true,
  "test": {
    "id": "uuid",
    "status": "completed",
    "impressions": 1000,
    "leads": 15,
    "cpl_cents": 133,
    "llm_score": 85,
    "llm_verdict": "excellent",
    "llm_reasoning": "Отличный CTR и низкий CPL...",
    "llm_video_analysis": "Люди смотрят до 75%, падение на 85%...",
    "llm_text_recommendations": "Усилить призыв к действию...",
    "transcript_suggestions": [
      {
        "from": "Здравствуйте, меня зовут...",
        "to": "Вы хотите...",
        "reason": "Начните с проблемы клиента",
        "position": "начало"
      }
    ]
  }
}
```

### 3. Статус активных тестов (для cron)

```http
GET /api/creative-test/status

Response:
{
  "success": true,
  "count": 3,
  "tests": [...]
}
```

### 4. Проверка и обновление метрик (для cron)

```http
POST /api/creative-test/check/:test_id

Response:
{
  "success": true,
  "ready_for_analysis": true,  // если >= 1000 impressions
  "insights": {
    "impressions": 1000,
    "clicks": 50,
    ...
  }
}
```

### 5. LLM анализ результатов

```http
POST /api/brain/analyze-creative-test

Request:
{
  "test_id": "uuid"
}

Response:
{
  "success": true,
  "test_id": "uuid",
  "analysis": {
    "score": 85,
    "verdict": "excellent",
    "reasoning": "...",
    "video_analysis": "...",
    "text_recommendations": "...",
    "transcript_match_quality": "high",
    "transcript_suggestions": [...]
  }
}
```

---

## 🤖 LLM АНАЛИЗАТОР

### Входные данные:
- **Метрики**: CPL, CTR, CPM, CPC, видео просмотры
- **Транскрибация**: Текст из видео

### Анализ:
1. **Оценка 0-100** на основе всех метрик
2. **Вердикт**: excellent (80+), good (60-79), average (40-59), poor (0-39)
3. **Видео анализ**: На каком проценте теряем внимание
4. **Сопоставление с текстом**: Какие фразы работают/не работают
5. **Конкретные рекомендации**: "Замени фразу X на Y потому что..."

### Критерии оценки:
- ✅ Низкий CPL + Высокий CTR + Видео до конца = Excellent
- ⚠️ Много кликов но мало лидов = Average
- ❌ Уход на 25% видео + Высокий CPL = Poor

---

## 🔄 CRON ЗАДАЧИ

### Проверка активных тестов (каждые 5 минут)

```bash
*/5 * * * * curl -X GET http://localhost:8080/api/creative-test/status
```

**Логика:**
1. Получить все тесты со статусом `running`
2. Для каждого теста:
   - Вызвать `/api/creative-test/check/:test_id`
   - Обновить метрики из Facebook Insights
   - Если `impressions >= 1000`:
     - Вызвать `/api/brain/analyze-creative-test`
     - Статус → `completed`

---

## 🎬 FACEBOOK AUTO RULE

**Параметры:**
```javascript
{
  "name": "Stop at 1000 impressions",
  "status": "ACTIVE",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "schedule_spec": {
      "schedule": ["EVERY_15_MIN"]  // Проверка каждые 15 минут
    },
    "filters": [{
      "field": "impressions",
      "operator": "GREATER_THAN",
      "value": 1000
    }]
  },
  "execution_spec": {
    "execution_type": "PAUSE"
  }
}
```

**Что делает:**
- Facebook каждые 15 минут проверяет impressions
- Когда impressions > 1000 → автоматически паузит AdSet
- Наш cron забирает метрики и запускает LLM анализ

---

## 📈 МЕТРИКИ

### Основные:
- **Impressions**: Показы (лимит 1000)
- **Reach**: Уникальные охват
- **Frequency**: Частота показа
- **CTR**: Click-through rate (общий)
- **Link CTR**: CTR по ссылкам
- **CPM**: Cost per 1000 impressions
- **CPC**: Cost per click
- **CPL**: Cost per lead

### Видео:
- **Video Views**: Просмотры
- **25/50/75/95% Views**: Глубина просмотра
- **Avg Watch Time**: Среднее время просмотра

### Рекомендуемые пороги:
- **Excellent**: CPL < $2, CTR > 3%, Video 75%+ > 50%
- **Good**: CPL $2-4, CTR 2-3%, Video 50%+ > 50%
- **Average**: CPL $4-6, CTR 1-2%, Video 25%+ > 50%
- **Poor**: CPL > $6, CTR < 1%, Video 25%+ < 50%

---

## 🎨 ФРОНТ ИНТЕГРАЦИЯ

### 1. Запуск теста

```javascript
// Кнопка "Быстрый тест"
async function startQuickTest(creativeId) {
  const response = await fetch('/api/creative-test/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_creative_id: creativeId,
      user_id: currentUserId
    })
  });
  
  const result = await response.json();
  console.log('Test started:', result.test_id);
}
```

### 2. Realtime подписка (Supabase)

```javascript
// Подписка на изменения в creative_tests
const subscription = supabase
  .channel('creative_tests')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'creative_tests',
      filter: `user_id=eq.${currentUserId}`
    },
    (payload) => {
      console.log('Test updated:', payload.new);
      
      if (payload.new.status === 'completed') {
        // Показываем результаты
        showTestResults(payload.new);
      }
    }
  )
  .subscribe();
```

### 3. Отображение результатов

```javascript
function showTestResults(test) {
  return (
    <div>
      <h3>Результаты теста</h3>
      <div className="score">
        Оценка: {test.llm_score}/100
        <Badge>{test.llm_verdict}</Badge>
      </div>
      
      <div className="metrics">
        <MetricCard title="CPL" value={`$${(test.cpl_cents / 100).toFixed(2)}`} />
        <MetricCard title="CTR" value={`${test.ctr}%`} />
        <MetricCard title="Leads" value={test.leads} />
      </div>
      
      <div className="analysis">
        <h4>Анализ</h4>
        <p>{test.llm_reasoning}</p>
        
        <h4>Видео</h4>
        <p>{test.llm_video_analysis}</p>
        
        <h4>Рекомендации</h4>
        <p>{test.llm_text_recommendations}</p>
        
        {test.transcript_suggestions?.map((s, i) => (
          <SuggestionCard key={i} suggestion={s} />
        ))}
      </div>
    </div>
  );
}
```

---

## 🔧 НАСТРОЙКИ

### Environment Variables

```bash
# Agent-Service
PORT=8080
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE=xxx

# Agent-Brain
BRAIN_PORT=7080
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o

# Facebook
FB_API_VERSION=v20.0
```

---

## 📋 TODO (Следующие шаги)

### Обязательно:
- [ ] Выполнить миграцию `006_creative_tests.sql` в Supabase
- [ ] Настроить cron для проверки тестов
- [ ] Протестировать создание теста
- [ ] Протестировать LLM анализ

### Опционально:
- [ ] Dashboard с историей всех тестов
- [ ] Сравнение нескольких креативов
- [ ] Экспорт рекомендаций в PDF
- [ ] А/B тест нескольких креативов одновременно

---

## 🚀 ПРЕИМУЩЕСТВА

### ДЛЯ БИЗНЕСА:
- ✅ Быстрая валидация креативов ($20, 1000 показов)
- ✅ Автоматический анализ без ручной работы
- ✅ Конкретные рекомендации по улучшению
- ✅ История всех тестов в одном месте

### ДЛЯ ПОЛЬЗОВАТЕЛЯ:
- ✅ Одна кнопка "Быстрый тест"
- ✅ Автоматическое отключение
- ✅ Понятные рекомендации от LLM
- ✅ Realtime обновления на фронте

### ТЕХНИЧЕСКИЕ:
- ✅ Чистая архитектура (отдельная таблица)
- ✅ Facebook Auto Rule (без ручного контроля)
- ✅ LLM анализ с транскрибацией
- ✅ Supabase Realtime для фронта

---

## 📚 СВЯЗАННЫЕ ДОКУМЕНТЫ

- `migrations/006_creative_tests.sql` — схема БД
- `services/agent-service/src/workflows/creativeTest.ts` — workflow
- `services/agent-service/src/routes/creativeTest.ts` — API эндпоинты
- `services/agent-brain/src/creativeAnalyzer.js` — LLM анализатор

---

**Готово к тестированию!** 🎉
