# Scoring Agent - Быстрый старт

## ⚡ TL;DR

Scoring Agent — это модуль внутри agent-brain, который:
- ✅ Оценивает риски роста CPL (стоимости лида)
- ✅ Предсказывает CPL на 3 дня вперед
- ✅ Анализирует активные креативы из базы
- ✅ Передает рекомендации main brain agent

**Запускается автоматически** при каждом вызове `/api/brain/run`.

## 🚀 Быстрый старт (5 минут)

### 1. Выполнить миграцию БД

```bash
# Через psql
psql -h your-supabase-host -U postgres -d postgres \
  -f migrations/001_scoring_agent_tables.sql

# Или через Supabase Dashboard → SQL Editor
# Скопировать и выполнить содержимое migrations/001_scoring_agent_tables.sql
```

### 2. Добавить переменные в .env.brain

```bash
# Scoring Agent (добавить в конец файла)
SCORING_ENABLED=true
SCORING_MIN_IMPRESSIONS=1000
SCORING_PREDICTION_DAYS=3
SCORING_MODEL=gpt-5
```

### 3. Пересобрать и запустить

```bash
docker-compose build --no-cache agent-brain
docker-compose up -d agent-brain
```

### 4. Проверить работу

```bash
# Тест 1: Проверить создание таблиц
docker exec -it agents-monorepo-agent-brain-1 sh -c \
  "echo 'SELECT tablename FROM pg_tables WHERE tablename LIKE \"%scoring%\" OR tablename LIKE \"%creative%\";' | psql $SUPABASE_URL"

# Тест 2: Запустить scoring вручную
curl -X POST http://localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{"userAccountId":"<your-uuid>","inputs":{"dispatch":false}}' \
  | jq '.scoring.summary'

# Ожидаемый ответ:
# {
#   "high_risk_count": 2,
#   "medium_risk_count": 3,
#   "low_risk_count": 5,
#   "overall_trend": "declining",
#   "alert_level": "warning"
# }

# Тест 3: Проверить логи
docker logs agents-monorepo-agent-brain-1 --tail 50 | grep scoring
```

## ✅ Готово!

Теперь при каждом запуске brain agent:
1. Сначала выполняется scoring
2. Результаты попадают в LLM input
3. Main brain учитывает их при принятии решений

## 📊 Что дальше?

### Настройка коэффициентов (опционально)

Если хотите изменить веса риска для конкретного пользователя:

```sql
INSERT INTO risk_scoring_config (scope, scope_id, w_cpm, w_ctr, low_max, medium_max)
VALUES ('user', '<user_account_id>', 28, 27, 24, 49);
```

### Мониторинг

```sql
-- Посмотреть последние запуски
SELECT 
  created_at,
  status,
  items_analyzed,
  high_risk_count,
  duration_ms
FROM scoring_executions
ORDER BY created_at DESC
LIMIT 10;

-- Статистика за неделю
SELECT 
  DATE(created_at) as date,
  AVG(high_risk_count) as avg_high,
  AVG(medium_risk_count) as avg_medium,
  AVG(low_risk_count) as avg_low
FROM scoring_executions
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at);
```

### Отладка

```bash
# Включить debug-логи
echo "BRAIN_DEBUG_LLM=true" >> .env.brain
docker-compose restart agent-brain

# Отключить scoring временно
echo "SCORING_ENABLED=false" >> .env.brain
docker-compose restart agent-brain

# Посмотреть полный scoring output
curl -X POST http://localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{"userAccountId":"<uuid>","inputs":{"dispatch":false}}' \
  | jq '.scoring' > scoring_output.json
```

## 🐛 Проблемы?

### "creative_metrics_history does not exist"
```bash
# Миграция не выполнена - запустите еще раз
psql ... -f migrations/001_scoring_agent_tables.sql
```

### Пустой scoring output
```bash
# Недостаточно данных - снизьте порог или подождите
echo "SCORING_MIN_IMPRESSIONS=500" >> .env.brain
docker-compose restart agent-brain
```

### LLM timeout или ошибки
```bash
# Проверьте API key
docker logs agents-monorepo-agent-brain-1 | grep "OPENAI_API_KEY"

# Временно отключите LLM (будет работать базовый скоринг)
# В scoring.js установите useLLM: false
```

## 📚 Подробная документация

- [Полный план разработки](./SCORING_AGENT_PLAN.md)
- [Детальная инструкция по установке](./SCORING_SETUP.md)
- [Обзор проекта](./PROJECT_OVERVIEW_RU.md)

## 💡 Полезные команды

```bash
# Посмотреть текущую конфигурацию
SELECT * FROM risk_scoring_config;

# Посмотреть историю метрик
SELECT * FROM creative_metrics_history 
WHERE user_account_id = '<uuid>' 
ORDER BY date DESC 
LIMIT 20;

# Посмотреть текущие скоры
SELECT * FROM creative_scores 
WHERE user_account_id = '<uuid>' 
ORDER BY risk_score DESC;

# Очистить старые данные (>30 дней)
DELETE FROM creative_metrics_history 
WHERE date < NOW() - INTERVAL '30 days';

DELETE FROM scoring_executions 
WHERE created_at < NOW() - INTERVAL '30 days';
```

---

**Все работает?** Отлично! Scoring agent теперь помогает предсказывать проблемы и оптимизировать кампании. 🎉

