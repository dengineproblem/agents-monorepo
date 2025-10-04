# 🧪 Scoring Agent - Руководство по тестированию

**Дата**: 2025-10-04

## ✅ Что уже сделано:

1. ✅ Создан модуль `services/agent-brain/src/scoring.js` (упрощенная версия)
2. ✅ Интегрирован в `services/agent-brain/src/server.js`
3. ✅ Подготовлена SQL миграция `migrations/001_scoring_agent_tables.sql` (упрощенная)
4. ✅ Обновлена документация (SCORING_AGENT_PLAN.md, PROJECT_OVERVIEW_RU.md)

## 🚀 Шаги тестирования:

---

### 📝 ШАГ 1: Выполнить SQL миграции в Supabase

**Где**: Supabase Dashboard → SQL Editor

**Что делать**:

1. Открой Supabase Dashboard
2. Перейди в **SQL Editor**
3. Скопируй содержимое файла `migrations/001_scoring_agent_tables.sql`
4. Вставь в SQL Editor
5. Нажми **Run**

**Проверка**:

```sql
-- Проверь, что таблицы созданы
SELECT table_name 
FROM information_schema.tables 
WHERE table_name IN ('creative_metrics_history', 'scoring_executions', 'creative_scores');
```

Должно вернуть 3 строки.

**Ожидаемый результат**:
```
creative_metrics_history
scoring_executions
creative_scores
```

---

### 🐳 ШАГ 2: Пересобрать Docker образ agent-brain

**Где**: Терминал в корне проекта

**Команды**:

```bash
cd /Users/anatolijstepanov/agents-monorepo

# Остановить текущий контейнер
docker-compose stop agent-brain

# Пересобрать образ
docker-compose build agent-brain

# Запустить контейнер
docker-compose up -d agent-brain

# Проверить, что контейнер запущен
docker ps | grep agent-brain
```

**Ожидаемый результат**:
```
CONTAINER ID   IMAGE                          STATUS         PORTS
abc123def456   agents-monorepo-agent-brain    Up 10 seconds  0.0.0.0:7080->7080/tcp
```

**Проверка логов**:

```bash
# Последние 50 строк логов
docker logs agents-monorepo-agent-brain-1 --tail 50
```

Должно быть что-то вроде:
```
{"level":30,"time":...,"msg":"Server listening at http://0.0.0.0:7080"}
```

---

### 🧪 ШАГ 3: Тестовый запуск scoring agent

**Где**: Терминал

**Что нужно**:
- UUID пользователя из таблицы `user_accounts` (с активным `active=true` и заполненными FB данными)

**Команда**:

```bash
# Замени YOUR_UUID на реальный UUID пользователя
curl -X POST http://localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{
    "userAccountId": "YOUR_UUID",
    "inputs": { "dispatch": false }
  }' | jq '.scoring'
```

**Ожидаемый результат** (примерный):

```json
{
  "summary": {
    "high_risk_count": 1,
    "medium_risk_count": 2,
    "low_risk_count": 3,
    "overall_trend": "stable",
    "alert_level": "warning"
  },
  "active_items": [
    {
      "level": "adset",
      "id": "123456789",
      "name": "WhatsApp - Autumn Sale",
      "campaign_id": "987654321",
      "risk_score": 45,
      "risk_level": "High",
      "trend": "declining",
      "prediction": {
        "days": 3,
        "cpl_current": 2.1,
        "cpl_predicted": 2.75,
        "change_pct": 31,
        "confidence": "high"
      },
      "reasons": [
        "CPM вырос на 12%",
        "CTR упал на 15%"
      ],
      "recommendations": [
        "Снизить бюджет на 30%",
        "Ротировать креативы"
      ]
    }
  ],
  "ready_creatives": [
    {
      "name": "Осенняя акция",
      "creatives": [
        {
          "objective": "MESSAGES",
          "fb_creative_id": "120210123456789012",
          "creative_score": 85,
          "performance": {
            "avg_ctr": 2.3,
            "avg_cpm": 4.2,
            "avg_cpl": 1.84
          }
        }
      ]
    }
  ],
  "recommendations_for_brain": [
    "HIGH RISK: adset X → снизить бюджет",
    "АЛЬТЕРНАТИВА: создать новую кампанию с fb_creative_id=..."
  ]
}
```

---

### 📊 ШАГ 4: Проверить логи scoring agent

**Команда**:

```bash
# Фильтр по scoring_agent
docker logs agents-monorepo-agent-brain-1 --tail 200 | grep scoring_agent
```

**Что искать**:

```
{"where":"scoring_agent","phase":"start","userId":"..."}
{"where":"scoring_agent","phase":"fetching_adsets"}
{"where":"scoring_agent","phase":"adsets_fetched","last_7d":15,"prev_7d":15}
{"where":"scoring_agent","phase":"fetching_creatives"}
{"where":"scoring_agent","phase":"creatives_fetched","count":5}
{"where":"scoring_agent","phase":"calling_llm"}
{"where":"scoring_agent","phase":"llm_complete","summary":{...}}
{"where":"scoring_agent","phase":"complete","duration":5432}
```

**Если ошибка**:

```
{"where":"scoring_agent","phase":"error","error":"FB insights failed: 400 ..."}
```

Возможные причины:
- Неверный access_token в user_accounts
- Нет активных adsets
- ad_account_id неправильный

---

### 🗄️ ШАГ 5: Проверить данные в Supabase

**Где**: Supabase Dashboard → SQL Editor

#### 5.1. Проверить историю запусков:

```sql
SELECT 
  id,
  user_account_id,
  started_at,
  completed_at,
  duration_ms,
  status,
  items_analyzed,
  creatives_analyzed,
  high_risk_count,
  medium_risk_count,
  low_risk_count,
  llm_used,
  llm_model
FROM scoring_executions
ORDER BY created_at DESC
LIMIT 5;
```

**Ожидаемый результат**:
```
id                  | user_account_id | status  | items_analyzed | high | medium | low
--------------------|-----------------|---------|----------------|------|--------|-----
uuid-1              | uuid-user-1     | success | 15             | 2    | 3      | 10
```

#### 5.2. Проверить полный output от LLM:

```sql
SELECT 
  scoring_output
FROM scoring_executions
WHERE user_account_id = 'YOUR_UUID'
ORDER BY created_at DESC
LIMIT 1;
```

Должен вернуть JSON с полной структурой (summary, active_items, ready_creatives, recommendations_for_brain).

#### 5.3. Проверить текущие скоры:

```sql
SELECT 
  level,
  adset_id,
  name,
  risk_score,
  risk_level,
  prediction_trend,
  prediction_cpl_current,
  prediction_cpl_expected,
  date
FROM creative_scores
WHERE user_account_id = 'YOUR_UUID'
AND date = CURRENT_DATE
ORDER BY risk_score DESC;
```

#### 5.4. Проверить snapshot метрик (аудит):

```sql
SELECT 
  date,
  adset_id,
  impressions,
  ctr,
  cpm,
  frequency,
  quality_ranking,
  engagement_rate_ranking,
  conversion_rate_ranking
FROM creative_metrics_history
WHERE user_account_id = 'YOUR_UUID'
ORDER BY date DESC
LIMIT 10;
```

---

### 🔍 ШАГ 6: Проверить интеграцию с main brain

**Команда**:

```bash
# Полный вывод brain (с scoring данными)
curl -X POST http://localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{
    "userAccountId": "YOUR_UUID",
    "inputs": { "dispatch": false }
  }' > brain_output.json

# Посмотреть scoring секцию
cat brain_output.json | jq '.scoring'

# Посмотреть actions (должны учитывать scoring)
cat brain_output.json | jq '.actions'
```

**Что проверить**:

1. **Scoring данные передаются в main brain?**
   - `llmInput.scoring` должен содержать данные от scoring agent

2. **Main brain использует scoring данные?**
   - Actions должны учитывать HIGH risk adsets
   - В `reason` должны быть упоминания "scoring agent" или "HIGH RISK"

3. **Recommendations присутствуют?**
   - В reportText или planNote должны быть рекомендации от scoring agent

---

## 🐛 Отладка проблем

### Проблема 1: Scoring agent не запускается

**Проверь**:

```bash
# Переменные окружения
docker exec agents-monorepo-agent-brain-1 env | grep SCORING

# Должно быть:
# SCORING_ENABLED=true
# SCORING_MODEL=gpt-4o
```

**Решение**:

Добавь в `docker-compose.yml` или `.env`:
```yaml
environment:
  - SCORING_ENABLED=true
  - SCORING_MODEL=gpt-4o
```

### Проблема 2: FB API ошибки

**Ошибка**: `FB insights failed: 400 Invalid OAuth access token`

**Решение**:
- Проверь `access_token` в таблице `user_accounts`
- Обнови токен через Facebook Graph API Explorer

**Ошибка**: `FB insights failed: 400 (#100) No adsets found`

**Решение**:
- Проверь, что у пользователя есть АКТИВНЫЕ adsets
- Убедись, что `ad_account_id` правильный (формат: `act_123456789`)

### Проблема 3: LLM не вызывается

**Проверь логи**:

```bash
docker logs agents-monorepo-agent-brain-1 | grep scoring_agent | grep llm
```

**Возможные причины**:
- `OPENAI_API_KEY` не установлен
- `options.responsesCreate` не передается
- Нет активных adsets (LLM пропускается, если нечего анализировать)

### Проблема 4: Данные не сохраняются в Supabase

**Проверь**:

```bash
# Переменные окружения для Supabase
docker exec agents-monorepo-agent-brain-1 env | grep SUPABASE

# Должно быть:
# SUPABASE_URL=https://...
# SUPABASE_SERVICE_ROLE_KEY=...
```

**Решение**:
- Убедись, что `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` установлены
- Проверь permissions в Supabase (service_role должен иметь доступ к таблицам)

---

## 📈 Следующие шаги после успешного теста

1. ✅ **Мониторинг**: Настроить алерты на ошибки scoring agent
2. ✅ **Аналитика**: Проверить точность предикшенов через неделю
3. ✅ **Оптимизация**: Улучшить SYSTEM_PROMPT на основе реальных результатов
4. ✅ **UI**: Добавить страницу для просмотра scoring результатов (опционально)

---

## 📞 Контакты

Если что-то не работает:
1. Проверь логи: `docker logs agents-monorepo-agent-brain-1 --tail 200`
2. Проверь SQL: выполни SELECT запросы из шага 5
3. Проверь переменные окружения: `docker exec ... env | grep SCORING`

Удачи! 🚀

