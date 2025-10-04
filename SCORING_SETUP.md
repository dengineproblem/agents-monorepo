# Установка и настройка Scoring Agent

## 🎯 Что это такое

Scoring Agent — специализированный модуль внутри agent-brain, который:
- Анализирует риски роста CPL (стоимости лида)
- Дает предикшн на ближайшие 3 дня
- Оценивает активные креативы из базы `user_creatives`
- Предоставляет рекомендации для main brain agent

**Важно:** Scoring Agent запускается ПЕРЕД основным brain agent и передает ему свой анализ.

## 📋 Предварительные требования

- PostgreSQL/Supabase с правами на создание таблиц
- OpenAI API key (для LLM анализа)
- Facebook Ad Account access token
- Данные в таблице `user_creatives` (креативы с is_active=true)

## 🚀 Установка

### Шаг 1: Создать таблицы в Supabase

Выполните SQL миграцию:

```bash
psql -h your-supabase-host -U postgres -d postgres -f migrations/001_scoring_agent_tables.sql
```

Или через Supabase Dashboard:
1. Перейдите в SQL Editor
2. Скопируйте содержимое `migrations/001_scoring_agent_tables.sql`
3. Выполните

Таблицы, которые будут созданы:
- `creative_metrics_history` — история метрик по креативам
- `budget_audit` — история изменений бюджетов
- `risk_scoring_config` — настройки коэффициентов скоринга
- `scoring_executions` — логи запусков scoring agent
- `creative_scores` — текущие скоры креативов

### Шаг 2: Настроить переменные окружения

Скопируйте и отредактируйте:

```bash
cp env.brain.example .env.brain
```

Ключевые параметры для scoring:

```bash
# Включить/выключить scoring agent
SCORING_ENABLED=true

# Минимум показов для анализа (меньше = низкая достоверность)
SCORING_MIN_IMPRESSIONS=1000

# На сколько дней вперед предикшн
SCORING_PREDICTION_DAYS=3

# Модель LLM для scoring (рекомендуется gpt-5)
SCORING_MODEL=gpt-5
```

### Шаг 3: Пересобрать Docker образ

```bash
docker-compose build --no-cache agent-brain
docker-compose up -d
```

## 🔧 Конфигурация скоринга

### Глобальные настройки (по умолчанию)

Автоматически создаются при миграции в таблице `risk_scoring_config`:

- **Веса риска**: CPM=30, CTR=25, FREQ=20, BUDGET_JUMP=15, RANK_DROP=10
- **Пороги**: Low ≤19, Medium ≤39, High ≥40
- **Frequency**: floor=1.9, span=0.8

### Настройка per-user

```sql
INSERT INTO risk_scoring_config (scope, scope_id, w_cpm, w_ctr, low_max, medium_max)
VALUES ('user', '<user_account_id>', 28, 27, 24, 49);
```

### Настройка per-campaign

```sql
INSERT INTO risk_scoring_config (scope, scope_id, freq_floor, w_budget_jump)
VALUES ('campaign', 'act_123/camp_456', 1.7, 20);
```

## 📊 Как это работает

### Архитектура потока

```
CRON (08:00)
    ↓
┌──────────────────────────────┐
│ /api/brain/run              │
│                              │
│ 1. runScoringAgent()        │
│    - Сбор метрик FB API     │
│    - Расчет risk scores     │
│    - LLM анализ             │
│    - Предикшн CPL           │
│    ↓                         │
│    scoring_output            │
│                              │
│ 2. Сбор данных FB            │
│    (campaigns/adsets/ads)    │
│                              │
│ 3. llmInput = {              │
│      scoring: scoring_output │
│      analysis: { ... }       │
│    }                         │
│                              │
│ 4. Main LLM Brain            │
│    - Учитывает scoring data  │
│    - Генерирует actions      │
│                              │
│ 5. Agent Service (execute)   │
│                              │
│ 6. Telegram Report           │
└──────────────────────────────┘
```

### Формула риска

```
risk_score = w_cpm × max(0, CPM3/CPM7 - 1) +
             w_ctr × max(0, 1 - CTR3/CTR7) +
             w_freq × max(0, (FREQ - 1.9)/0.8) +
             w_budget_jump × I[budget_jump≥30%] +
             w_rank_drop × I[rank_drop]
```

Где:
- **CPM3/CPM7**: рост CPM за 3 дня vs 7 дней
- **CTR3/CTR7**: падение CTR
- **FREQ**: текущая частота показов
- **budget_jump**: резкий рост бюджета за 24ч
- **rank_drop**: ухудшение diagnostics rankings

## 🧪 Тестирование

### 1. Проверить создание таблиц

```sql
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename LIKE '%scoring%' OR tablename LIKE '%creative%';
```

Должны быть:
- creative_metrics_history
- creative_scores
- risk_scoring_config
- scoring_executions

### 2. Проверить глобальную конфигурацию

```sql
SELECT * FROM risk_scoring_config WHERE scope = 'global';
```

### 3. Запустить scoring вручную

```bash
curl -X POST http://localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{
    "userAccountId": "<your-user-uuid>",
    "inputs": {
      "dispatch": false
    }
  }' | jq '.scoring'
```

Ожидаемый ответ:
```json
{
  "summary": {
    "high_risk_count": 2,
    "medium_risk_count": 3,
    "low_risk_count": 5,
    "overall_trend": "declining",
    "alert_level": "warning"
  },
  "items": [...],
  "active_creatives_ready": [...],
  "recommendations_for_brain": [...]
}
```

### 4. Проверить логи

```bash
docker logs agents-monorepo-agent-brain-1 --tail 50 | grep scoring
```

Должны быть записи:
- `scoring_start`
- `scoring_complete` (или `scoring_failed`)
- Детальная статистика

### 5. Проверить сохранение в базе

```sql
-- Последние запуски scoring
SELECT id, user_account_id, status, items_analyzed, high_risk_count, duration_ms
FROM scoring_executions
ORDER BY created_at DESC
LIMIT 5;

-- История метрик
SELECT date, ad_id, ctr, cpm, frequency, quality_ranking
FROM creative_metrics_history
WHERE user_account_id = '<your-user-uuid>'
ORDER BY date DESC
LIMIT 10;
```

## 🔍 Отладка

### Включить debug-логи

```bash
# В .env.brain
BRAIN_DEBUG_LLM=true
```

Это добавит в ответ полный LLM input/output.

### Отключить scoring временно

```bash
# В .env.brain
SCORING_ENABLED=false
```

Brain будет работать без scoring данных.

### Посмотреть scoring output в ответе

```bash
curl -X POST http://localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{"userAccountId":"<uuid>","inputs":{"dispatch":false}}' \
  | jq '.scoring'
```

## 📈 Мониторинг

### Ключевые метрики

```sql
-- Статистика по risk levels за последние 7 дней
SELECT 
  DATE(created_at) as date,
  AVG(high_risk_count) as avg_high,
  AVG(medium_risk_count) as avg_medium,
  AVG(low_risk_count) as avg_low
FROM scoring_executions
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Производительность
SELECT 
  user_account_id,
  AVG(duration_ms) as avg_duration_ms,
  COUNT(*) as runs_count,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors_count
FROM scoring_executions
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY user_account_id;
```

### Алерты

Настроить мониторинг на:
- `scoring_executions.status = 'error'` — ошибки в scoring
- `scoring_executions.duration_ms > 10000` — медленная работа
- `scoring_executions.high_risk_count > 5` — много высоких рисков

## 🐛 Частые проблемы

### 1. Ошибка "creative_metrics_history does not exist"

**Причина**: не выполнена миграция

**Решение**:
```bash
psql -h your-supabase-host -U postgres -d postgres -f migrations/001_scoring_agent_tables.sql
```

### 2. Пустой scoring output

**Причина**: недостаточно данных (< SCORING_MIN_IMPRESSIONS)

**Решение**: Снизить порог или подождать накопления данных
```bash
SCORING_MIN_IMPRESSIONS=500
```

### 3. LLM возвращает невалидный JSON

**Причина**: модель не следует инструкциям или timeout

**Решение**:
- Проверить OPENAI_API_KEY
- Увеличить timeout
- Использовать fallback (без LLM):
```bash
# В scoring.js можно отключить LLM временно
useLLM: false
```

### 4. Scoring занимает >10 секунд

**Причина**: много объявлений или медленный FB API

**Решение**:
- Добавить фильтрацию по минимальному spend
- Кэшировать diagnostics rankings
- Запускать реже (не каждый прогон brain)

## 📚 Дополнительные ресурсы

- [Полный план разработки](./SCORING_AGENT_PLAN.md)
- [Обзор проекта](./PROJECT_OVERVIEW_RU.md)
- [Документация Meta API](https://developers.facebook.com/docs/marketing-api/insights/)

## 🤝 Поддержка

При проблемах проверьте:
1. Логи Docker: `docker logs agents-monorepo-agent-brain-1`
2. Таблицу `scoring_executions` на наличие ошибок
3. Переменные окружения в `.env.brain`

