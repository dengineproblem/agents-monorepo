# Scoring Agent - Агент предикшена и скоринга (SIMPLIFIED)

**Дата**: 2025-10-04  
**Версия**: 2.0 (упрощенная)

## 🎯 Задача

Scoring Agent анализирует активные ad sets и готовые креативы, предсказывает риск роста CPL на ближайшие 3 дня и дает рекомендации main brain агенту.

## 🏗️ Архитектура (упрощенная!)

```
CRON (08:00) 
  ↓
┌─────────────────────────────────────────────────┐
│ Agent Brain (/api/brain/run)                    │
│                                                  │
│  1. ┌──────────────────────┐                   │
│     │ SCORING AGENT        │                    │
│     │                       │                    │
│     │ A. FB API: adsets    │ ← last_7d         │
│     │    (активные only)   │ ← prev_7d         │
│     │                       │                    │
│     │ B. FB API: creatives │ ← last_30d        │
│     │    (из user_creatives)│                   │
│     │                       │                    │
│     │ C. LLM: оценка риска │ ← все метрики     │
│     │    + предикшн CPL    │                    │
│     └─────────┬────────────┘                    │
│               ↓                                  │
│     scoring_output = {                          │
│       summary: { high/medium/low counts },      │
│       active_items: [                           │
│         { adset_id, risk_score, prediction }    │
│       ],                                         │
│       ready_creatives: [                        │
│         { fb_creative_id, score, performance }  │
│       ],                                         │
│       recommendations_for_brain: []             │
│     }                                            │
│               ↓                                  │
│  2. ┌──────────────────────┐                   │
│     │ Сбор данных FB       │                    │
│     │ (campaigns/adsets)   │                    │
│     └─────────┬────────────┘                    │
│               ↓                                  │
│  3. llmInput = {                                │
│       scoring: scoring_output,  ← НОВОЕ!        │
│       analysis: { ... },                        │
│       targets: { ... }                          │
│     }                                            │
│               ↓                                  │
│  4. ┌──────────────────────┐                   │
│     │ MAIN BRAIN LLM       │                    │
│     │ - Анализирует все    │                    │
│     │ - Генерирует actions │                    │
│     └─────────┬────────────┘                    │
│               ↓                                  │
│  5. Agent Service (execute)                     │
│               ↓                                  │
│  6. Telegram Report                             │
└─────────────────────────────────────────────────┘
```

## 🔑 Ключевая философия

### ❌ СТАРЫЙ подход (сложный):
```
1. Fetch FB API → save to creative_metrics_history
2. Read from creative_metrics_history
3. Calculate trends manually
4. Calculate risk_score by formula
5. Pass to LLM
```

### ✅ НОВЫЙ подход (простой):
```
1. Fetch FB API напрямую:
   - last_7d (текущие метрики)
   - previous_7d (для сравнения)
   - last_30d (для креативов)
2. LLM САМ оценивает risk_score
3. creative_metrics_history - только snapshot для аудита
```

## 📊 Данные для LLM

### Input для Scoring LLM:

```json
{
  "user_account_id": "uuid",
  "date": "2025-10-04",
  
  "active_adsets": [
    {
      "adset_id": "123",
      "adset_name": "WhatsApp - Autumn",
      "campaign_id": "789",
      "campaign_name": "Lead Gen Oct",
      
      "metrics_last_7d": {
        "cpm": 5.20,
        "ctr": 1.8,
        "frequency": 2.8,
        "impressions": 15000,
        "spend": 78.00,
        "reach": 5357
      },
      
      "metrics_prev_7d": {
        "cpm": 4.80,
        "ctr": 2.1,
        "frequency": 2.3,
        "impressions": 12000
      },
      
      "trend": {
        "cpm_change_pct": 8.3,
        "ctr_change_pct": -14.3
      },
      
      "diagnostics": {
        "quality_ranking": "below_average_35",
        "engagement_rate_ranking": "average",
        "conversion_rate_ranking": "below_average_20",
        "ads_count": 3
      }
    }
  ],
  
  "ready_creatives": [
    {
      "name": "Осенняя акция - скидка 30%",
      "category": "seasonal_promo",
      "creatives": [
        {
          "objective": "MESSAGES",
          "fb_creative_id": "120210123456789012",
          "performance": {
            "impressions": 25000,
            "spend": 105.00,
            "reach": 8930,
            "avg_ctr": 2.3,
            "avg_cpm": 4.20,
            "avg_frequency": 2.1,
            "total_leads": 57,
            "avg_cpl": 1.84
          }
        },
        {
          "objective": "OUTCOME_LEADS",
          "fb_creative_id": "120210987654321098",
          "performance": { /* ... */ }
        }
      ]
    }
  ]
}
```

### Output от Scoring LLM:

```json
{
  "summary": {
    "high_risk_count": 2,
    "medium_risk_count": 3,
    "low_risk_count": 5,
    "overall_trend": "declining",
    "alert_level": "warning"
  },
  
  "active_items": [
    {
      "level": "adset",
      "id": "123",
      "name": "WhatsApp - Autumn",
      "campaign_id": "789",
      "risk_score": 65,
      "risk_level": "High",
      "trend": "declining",
      "prediction": {
        "days": 3,
        "cpl_current": 2.10,
        "cpl_predicted": 2.75,
        "change_pct": 31,
        "confidence": "high"
      },
      "reasons": [
        "CPM вырос на 8.3% за 7 дней",
        "CTR упал на 14.3%",
        "Quality ranking = below_average_35"
      ],
      "recommendations": [
        "Снизить бюджет на 30-40%",
        "Ротировать креативы",
        "Проверить таргетинг"
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
            "avg_cpm": 4.20,
            "avg_cpl": 1.84
          },
          "recommendation": "Отличный креатив для WhatsApp кампаний"
        }
      ],
      "overall_score": 85,
      "best_objective": "MESSAGES"
    }
  ],
  
  "recommendations_for_brain": [
    "HIGH RISK: adset 'WhatsApp - Autumn' → снизить бюджет на 30%",
    "АЛЬТЕРНАТИВА: создать новую кампанию MESSAGES с fb_creative_id=120210123456789012 (score 85)",
    "Medium RISK: adset 'Instagram Traffic' → ротировать креативы"
  ]
}
```

## 🗄️ База данных (упрощенная!)

### Таблица: `creative_metrics_history`

**Назначение**: Snapshot метрик на момент запуска (только для аудита/дебага)

```sql
CREATE TABLE creative_metrics_history (
  id UUID PRIMARY KEY,
  user_account_id UUID,
  date DATE,
  
  adset_id TEXT,
  campaign_id TEXT,
  creative_id TEXT,
  
  -- Snapshot метрик
  impressions INTEGER,
  spend DECIMAL(10,2),
  ctr DECIMAL(5,2),
  cpm DECIMAL(10,2),
  frequency DECIMAL(5,2),
  
  -- Diagnostics
  quality_ranking TEXT,
  engagement_rate_ranking TEXT,
  conversion_rate_ranking TEXT,
  
  created_at TIMESTAMPTZ
);
```

### Таблица: `scoring_executions`

**Назначение**: История запусков scoring agent (мониторинг, отладка)

```sql
CREATE TABLE scoring_executions (
  id UUID PRIMARY KEY,
  user_account_id UUID,
  
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT, -- success/error/partial
  
  items_analyzed INTEGER,
  creatives_analyzed INTEGER,
  high_risk_count INTEGER,
  medium_risk_count INTEGER,
  low_risk_count INTEGER,
  
  scoring_output JSONB, -- полный JSON от LLM
  
  llm_used BOOLEAN,
  llm_model TEXT,
  
  created_at TIMESTAMPTZ
);
```

### Таблица: `creative_scores`

**Назначение**: Текущие скоры для быстрого доступа (UI, API)

```sql
CREATE TABLE creative_scores (
  id UUID PRIMARY KEY,
  user_account_id UUID,
  
  level TEXT, -- 'adset' | 'creative'
  adset_id TEXT,
  creative_id TEXT,
  campaign_id TEXT,
  name TEXT,
  
  date DATE,
  risk_score INTEGER,
  risk_level TEXT, -- Low/Medium/High
  
  -- Предикшн от LLM
  prediction_trend TEXT,
  prediction_cpl_current DECIMAL(10,2),
  prediction_cpl_expected DECIMAL(10,2),
  prediction_change_pct DECIMAL(5,1),
  
  recommendations JSONB,
  
  created_at TIMESTAMPTZ
);
```

## 🚀 Как это работает

### 1. FB API запросы (прямые!)

```javascript
// Активные adsets - последние 7 дней
GET /act_{ad_account_id}/insights
  ?level=adset
  ?date_preset=last_7d
  ?filtering=[{"field":"adset.effective_status","operator":"IN","value":["ACTIVE"]}]
  ?fields=adset_id,adset_name,campaign_id,spend,impressions,ctr,cpm,frequency

// Активные adsets - предыдущие 7 дней (для сравнения)
GET /act_{ad_account_id}/insights
  ?level=adset
  ?time_range={"since":"2025-09-20","until":"2025-09-26"}
  ?filtering=[...]
  ?fields=...

// Diagnostics (на уровне ad, группируем по adset)
GET /act_{ad_account_id}/insights
  ?level=ad
  ?date_preset=last_7d
  ?fields=ad_id,adset_id,quality_ranking,engagement_rate_ranking,conversion_rate_ranking

// Креатив - статистика за 30 дней
GET /act_{ad_account_id}/insights
  ?level=ad
  ?filtering=[{"field":"ad.creative_id","operator":"EQUAL","value":"120210123456789012"}]
  ?date_preset=last_30d
  ?fields=ctr,cpm,frequency,impressions,spend,actions
```

### 2. LLM анализ

Scoring LLM получает все raw метрики и сам определяет:
- **Risk Score** (0-100) на основе комбинации факторов
- **Risk Level** (Low/Medium/High)
- **Prediction CPL** (что ожидать через 3 дня)
- **Recommendations** (что делать)

### 3. Integration с Main Brain

Main Brain получает `scoring_output` в `llmInput.scoring` и использует:
- При HIGH risk → приоритет на снижение бюджета
- `ready_creatives` → рекомендации для создания новых кампаний
- `recommendations_for_brain` → конкретные советы

## ⚙️ Переменные окружения

```bash
# В env.brain

# Включить scoring agent
SCORING_ENABLED=true

# Модель для scoring LLM (по умолчанию = BRAIN_MODEL)
SCORING_MODEL=gpt-4o

# Минимальное количество показов для надежного скоринга
SCORING_MIN_IMPRESSIONS=1000

# На сколько дней делать предикшн
SCORING_PREDICTION_DAYS=3
```

## 📝 Пример рекомендации для Main Brain

```
HIGH RISK: adset 'WhatsApp - Autumn Sale' (id: 123456)
  - CPL вырастет на 31% через 3 дня (с $2.10 до $2.75)
  - Причины: CPM +8%, CTR -14%, quality_ranking=below_average
  - Действия: снизить бюджет на 30-40%

АЛЬТЕРНАТИВА: создать новую кампанию
  - Использовать креатив 'Black Friday Promo' (fb_creative_id: 120210...)
  - Score 85, avg CPL $1.84, CTR 2.3%
  - Objective: MESSAGES (WhatsApp)
```

Main Brain анализирует это и генерирует actions:
```json
[
  {
    "type": "update_budget",
    "adset_id": "123456",
    "new_budget": 12.00,
    "reason": "HIGH RISK от scoring agent: CPL вырастет на 31%"
  },
  {
    "type": "create_campaign",
    "objective": "MESSAGES",
    "creative_id": "120210123456789012",
    "budget": 15.00,
    "reason": "Scoring agent рекомендует: score 85, хороший CPL"
  }
]
```

## 🧪 Тестирование

### 1. Выполнить SQL миграции

```bash
# В Supabase SQL Editor скопируй и выполни:
# migrations/001_scoring_agent_tables.sql
```

### 2. Пересобрать Docker

```bash
cd /Users/anatolijstepanov/agents-monorepo
docker-compose build agent-brain
docker-compose up -d agent-brain
```

### 3. Тестовый запуск

```bash
curl -X POST http://localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{
    "userAccountId": "YOUR_UUID",
    "inputs": { "dispatch": false }
  }' | jq '.scoring'
```

### 4. Проверить логи

```bash
docker logs agents-monorepo-agent-brain-1 --tail 100 | grep scoring_agent
```

### 5. Проверить данные в Supabase

```sql
-- Последний запуск scoring agent
SELECT * FROM scoring_executions 
WHERE user_account_id = 'YOUR_UUID'
ORDER BY created_at DESC 
LIMIT 1;

-- Текущие скоры
SELECT * FROM creative_scores 
WHERE user_account_id = 'YOUR_UUID'
AND date = CURRENT_DATE;
```

## 📚 Файлы проекта

```
services/agent-brain/
├── src/
│   ├── server.js           ← интеграция scoring agent
│   └── scoring.js          ← основной модуль (новая версия!)
│
migrations/
└── 001_scoring_agent_tables.sql  ← упрощенная схема БД

docs/
├── SCORING_AGENT_PLAN.md   ← этот файл
└── PROJECT_OVERVIEW_RU.md  ← обновлен с разделом про scoring
```

## ✅ Преимущества упрощенной версии

1. ✅ **Всегда свежие данные** - прямые запросы к FB API
2. ✅ **Меньше кода** - убрали ручной расчет трендов и risk_score
3. ✅ **Проще дебаг** - LLM сам объясняет почему выставил такой скор
4. ✅ **Гибкость** - LLM адаптируется к разным ситуациям
5. ✅ **Меньше таблиц** - убрали budget_audit, risk_scoring_config
6. ✅ **Быстрее работает** - меньше запросов к Supabase

## 🔄 Следующие шаги

- [ ] Тестирование на реальных данных
- [ ] Мониторинг точности предикшенов
- [ ] Оптимизация SYSTEM_PROMPT для Scoring LLM
- [ ] UI для просмотра scoring результатов
- [ ] Алерты при HIGH risk ситуациях
