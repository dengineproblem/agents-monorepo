# Ad Insights Anomaly Detection Service

Сервис для анализа эффективности рекламы Meta Ads с детекцией аномалий, прогнозированием выгорания и восстановления объявлений.

## Содержание

1. [Обзор](#обзор)
2. [Архитектура](#архитектура)
3. [База данных](#база-данных)
4. [API Endpoints](#api-endpoints)
5. [Алгоритмы](#алгоритмы)
6. [Использование](#использование)

---

## Обзор

### Что делает сервис

- **Синхронизация данных** — еженедельный сбор insights с Facebook Marketing API
- **Нормализация** — приведение метрик к единой шкале для сравнения
- **Детекция аномалий** — выявление отклонений в метриках объявлений
- **Анализ выгорания** — прогнозирование burnout рекламы на 1-2 недели вперёд
- **Прогноз восстановления** — предсказание recovery для degraded/burned_out объявлений
- **Годовой аудит** — Pareto анализ, поиск waste, анализ стабильности
- **Tracking Health** — мониторинг здоровья пикселя/CAPI

### Ключевые особенности

| Функция | Описание |
|---------|----------|
| Z-score нормализация | Сравнение метрик между разными аккаунтами |
| Lead-Lag анализ | Определение предикторов выгорания |
| Ranking Scores | Конвертация Facebook рейтингов в числовые оценки |
| Multi-level sync | Синхронизация на уровне Ad, AdSet, Campaign |

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                     Ad Insights Pipeline                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Facebook   │───▶│  adInsights  │───▶│   Supabase   │      │
│  │  Marketing   │    │    Sync.ts   │    │   (Tables)   │      │
│  │     API      │    └──────────────┘    └──────────────┘      │
│  └──────────────┘           │                   │               │
│                             │                   │               │
│                             ▼                   ▼               │
│                    ┌──────────────┐    ┌──────────────┐        │
│                    │   Result     │    │   Anomaly    │        │
│                    │  Normalizer  │    │   Detector   │        │
│                    └──────────────┘    └──────────────┘        │
│                             │                   │               │
│                             ▼                   ▼               │
│                    ┌──────────────┐    ┌──────────────┐        │
│                    │   Burnout    │    │   Yearly     │        │
│                    │   Analyzer   │    │   Analyzer   │        │
│                    └──────────────┘    └──────────────┘        │
│                             │                   │               │
│                             ▼                   ▼               │
│                    ┌──────────────┐    ┌──────────────┐        │
│                    │   Tracking   │    │    API       │        │
│                    │   Health     │    │   Routes     │        │
│                    └──────────────┘    └──────────────┘        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Файловая структура

```
services/agent-service/src/
├── routes/
│   └── adInsights.ts          # API endpoints (admin-only)
├── services/
│   ├── adInsightsSync.ts      # Синхронизация с Facebook API
│   ├── resultNormalizer.ts    # Z-score нормализация метрик
│   ├── anomalyDetector.ts     # Детекция аномалий
│   ├── burnoutAnalyzer.ts     # Анализ выгорания + recovery
│   ├── yearlyAnalyzer.ts      # Годовой аудит
│   └── trackingHealth.ts      # Здоровье tracking
```

---

## База данных

### Основные таблицы (Migration 106)

#### `meta_insights_weekly`
Еженедельные insights с Facebook API.

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | uuid | PK |
| ad_account_id | text | ID рекламного аккаунта |
| fb_ad_id | text | ID объявления |
| fb_adset_id | text | ID группы объявлений |
| fb_campaign_id | text | ID кампании |
| week_start_date | date | Начало недели (понедельник) |
| impressions | bigint | Показы |
| clicks | bigint | Клики |
| spend | numeric | Расход |
| results | numeric | Результаты (лиды/покупки) |
| ctr | numeric | Click-through rate |
| cpc | numeric | Cost per click |
| cpm | numeric | Cost per mille |
| cpr | numeric | Cost per result |
| frequency | numeric | Частота показа |
| reach | bigint | Охват |
| quality_ranking | text | Facebook quality ranking |
| engagement_ranking | text | Facebook engagement ranking |
| conversion_ranking | text | Facebook conversion ranking |
| quality_rank_score | integer | Числовой score (-3 to +2) |
| engagement_rank_score | integer | Числовой score (-3 to +2) |
| conversion_rank_score | integer | Числовой score (-3 to +2) |

#### `ad_weekly_features`
Вычисленные features для ML/статистики.

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | uuid | PK |
| ad_account_id | text | ID аккаунта |
| fb_ad_id | text | ID объявления |
| week_start_date | date | Начало недели |
| ctr_z | numeric | Z-score CTR |
| cpc_z | numeric | Z-score CPC |
| cpm_z | numeric | Z-score CPM |
| cpr_z | numeric | Z-score CPR |
| frequency_z | numeric | Z-score частоты |
| ctr_delta_pct | numeric | % изменение CTR vs прошлая неделя |
| cpc_delta_pct | numeric | % изменение CPC |
| cpr_delta_pct | numeric | % изменение CPR |
| freq_delta_pct | numeric | % изменение частоты |
| ctr_slope_4w | numeric | Тренд CTR за 4 недели |
| cpr_slope_4w | numeric | Тренд CPR за 4 недели |
| quality_score | integer | Quality ranking score |
| engagement_score | integer | Engagement ranking score |
| conversion_score | integer | Conversion ranking score |
| relevance_health | integer | Сумма ranking scores |
| quality_drop | integer | Падение quality vs прошлая неделя |
| engagement_drop | integer | Падение engagement |
| conversion_drop | integer | Падение conversion |
| min_results_met | boolean | Достаточно результатов для анализа |
| weeks_with_data | integer | Кол-во недель с данными |

#### `anomaly_alerts`
Обнаруженные аномалии.

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | uuid | PK |
| ad_account_id | text | ID аккаунта |
| fb_ad_id | text | ID объявления |
| week_start_date | date | Неделя аномалии |
| anomaly_type | text | Тип: ctr_drop, cpr_spike, frequency_spike, etc. |
| severity | text | low, medium, high, critical |
| metric_value | numeric | Значение метрики |
| z_score | numeric | Z-score отклонения |
| threshold | numeric | Порог срабатывания |
| message | text | Описание аномалии |
| is_acknowledged | boolean | Подтверждено пользователем |

#### `burnout_predictions`
Прогнозы выгорания.

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | uuid | PK |
| ad_account_id | text | ID аккаунта |
| fb_ad_id | text | ID объявления |
| week_start_date | date | Неделя прогноза |
| burnout_score | numeric | Score 0-1 |
| burnout_level | text | low, medium, high, critical |
| predicted_cpr_change_1w | numeric | Прогноз изменения CPR через 1 неделю |
| predicted_cpr_change_2w | numeric | Прогноз изменения CPR через 2 недели |
| top_signals | jsonb | Топ сигналы выгорания |
| confidence | numeric | Уверенность прогноза |

#### `lag_dependency_stats`
Статистика lead-lag зависимостей.

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | uuid | PK |
| ad_account_id | text | ID аккаунта |
| lead_metric | text | Предиктор (freq, ctr, etc.) |
| lag_metric | text | Целевая метрика (cpr) |
| optimal_lag | integer | Оптимальный лаг в неделях |
| correlation | numeric | Корреляция |
| sample_size | integer | Размер выборки |
| prediction_type | text | 'decay' или 'recovery' |

### Таблицы Iteration 2 (Migration 107)

#### `campaign_insights_weekly`
Insights на уровне кампаний.

#### `adset_insights_weekly`
Insights на уровне групп объявлений.

#### `yearly_audit_cache`
Кэш годового аудита.

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | uuid | PK |
| ad_account_id | text | ID аккаунта |
| year | integer | Год |
| audit_data | jsonb | Данные аудита (Pareto, waste, stability) |

#### `creative_lifecycle_stats`
Статистика жизненного цикла креативов.

#### `response_curve_data`
Данные кривой отклика (spend efficiency).

#### `goal_drift_data`
Данные изменения целей во времени.

#### `tracking_health_issues`
Проблемы tracking (пиксель/CAPI).

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | uuid | PK |
| ad_account_id | text | ID аккаунта |
| fb_ad_id | text | ID объявления |
| issue_type | text | clicks_no_results, results_dropped, high_volatility |
| severity | text | low, medium, high |
| details | jsonb | Детали проблемы |

---

## API Endpoints

> **Важно:** Все endpoints требуют admin-доступа (header `x-user-id` с `is_tech_admin = true`)

### Синхронизация

#### `POST /admin/ad-insights/:accountId/sync`
Запуск полной синхронизации для аккаунта.

**Query params:**
- `weeks` — количество недель (default: 12)
- `includeCampaigns` — синхронизировать campaigns (default: false)
- `includeAdsets` — синхронизировать adsets (default: false)

**Response:**
```json
{
  "success": true,
  "accountId": "act_123456",
  "weeksProcessed": 12,
  "adsProcessed": 150
}
```

#### `POST /admin/ad-insights/:accountId/sync/campaigns`
Синхронизация только на уровне кампаний.

#### `POST /admin/ad-insights/:accountId/sync/adsets`
Синхронизация только на уровне adsets.

### Аномалии

#### `GET /admin/ad-insights/:accountId/anomalies`
Получение списка аномалий.

**Query params:**
- `severity` — фильтр по severity (low, medium, high, critical)
- `type` — фильтр по типу аномалии
- `limit` — лимит записей (default: 100)

**Response:**
```json
{
  "anomalies": [
    {
      "id": "uuid",
      "fb_ad_id": "123456",
      "week_start_date": "2024-01-08",
      "anomaly_type": "cpr_spike",
      "severity": "high",
      "metric_value": 45.5,
      "z_score": 2.8,
      "message": "CPR increased by 45% week-over-week"
    }
  ],
  "total": 25
}
```

#### `POST /admin/ad-insights/:accountId/anomalies/:anomalyId/acknowledge`
Подтверждение аномалии (скрытие из списка).

### Прогнозы выгорания (Decay)

#### `GET /admin/ad-insights/:accountId/burnout/predictions`
Получение прогнозов выгорания для всех ads.

**Query params:**
- `minScore` — минимальный burnout score (0-1)
- `level` — фильтр по уровню (low, medium, high, critical)

**Response:**
```json
{
  "predictions": [
    {
      "fb_ad_id": "123456",
      "week_start_date": "2024-01-15",
      "burnout_score": 0.75,
      "burnout_level": "high",
      "predicted_cpr_change_1w": 25.5,
      "predicted_cpr_change_2w": 42.0,
      "top_signals": [
        {
          "metric": "frequency",
          "value": 3.5,
          "contribution": 0.25,
          "signal": "High frequency (3.5) indicates audience saturation"
        }
      ],
      "confidence": 0.82
    }
  ]
}
```

#### `GET /admin/ad-insights/:accountId/burnout/predict/:adId`
Прогноз выгорания для конкретного объявления.

#### `GET /admin/ad-insights/:accountId/burnout/lag-stats`
Статистика lead-lag зависимостей.

### Прогнозы восстановления (Recovery)

#### `GET /admin/ad-insights/:accountId/recovery/predictions`
Получение прогнозов recovery для degraded/burned_out ads.

**Response:**
```json
{
  "predictions": [
    {
      "fb_ad_id": "123456",
      "week_start_date": "2024-01-15",
      "recovery_score": 0.65,
      "recovery_level": "likely",
      "current_status": "degraded",
      "predicted_cpr_change_1w": -12.5,
      "predicted_cpr_change_2w": -18.0,
      "top_signals": [
        {
          "metric": "ctr_delta",
          "value": 15.2,
          "contribution": 0.20,
          "signal": "CTR growing +15.2% indicates recovery potential"
        }
      ],
      "confidence": 0.75
    }
  ]
}
```

#### `GET /admin/ad-insights/:accountId/recovery/predict/:adId`
Прогноз recovery для конкретного объявления.

#### `GET /admin/ad-insights/:accountId/decay-recovery`
Комбинированный анализ decay + recovery для всех ads.

**Response:**
```json
{
  "analysis": [
    {
      "fb_ad_id": "123456",
      "status": "degraded",
      "decay": { "score": 0.45, "level": "medium" },
      "recovery": { "score": 0.65, "level": "likely" },
      "recommendation": "Monitor - showing recovery signs"
    }
  ]
}
```

### Годовой аудит

#### `GET /admin/ad-insights/:accountId/yearly/audit`
Годовой аудит аккаунта.

**Query params:**
- `year` — год (default: текущий)

**Response:**
```json
{
  "year": 2024,
  "pareto": {
    "top20pct_ads": 15,
    "top20pct_results": 12500,
    "top20pct_results_share": 0.78,
    "bottom80pct_ads": 60,
    "bottom80pct_results": 3500
  },
  "bestWeeks": [
    { "week": "2024-03-04", "results": 450, "cpr": 12.5 }
  ],
  "worstWeeks": [
    { "week": "2024-08-12", "results": 85, "cpr": 45.2 }
  ],
  "waste": {
    "zeroResultsSpend": 1250.50,
    "highCprSpend": 3400.00,
    "totalWaste": 4650.50,
    "wastePercentage": 8.5
  },
  "stability": {
    "avgWeeklyVariation": 0.15,
    "maxDrawdown": 0.35,
    "consistentWeeks": 42
  }
}
```

#### `GET /admin/ad-insights/:accountId/yearly/creative-lifecycle`
Анализ жизненного цикла креативов.

#### `GET /admin/ad-insights/:accountId/yearly/waste`
Детальный поиск waste.

#### `GET /admin/ad-insights/:accountId/yearly/response-curve`
Кривая отклика (spend efficiency).

#### `GET /admin/ad-insights/:accountId/yearly/goal-drift`
Анализ изменения целей.

### Tracking Health

#### `GET /admin/ad-insights/:accountId/tracking-health`
Анализ здоровья tracking.

**Response:**
```json
{
  "overallHealth": 85,
  "status": "healthy",
  "issues": [
    {
      "fb_ad_id": "123456",
      "issue_type": "clicks_no_results",
      "severity": "medium",
      "details": {
        "clicks": 150,
        "results": 0,
        "weeks_affected": 2
      }
    }
  ],
  "recommendations": [
    "Check pixel installation on landing page for ad 123456"
  ]
}
```

---

## Алгоритмы

### Ranking Score Conversion

Facebook возвращает текстовые рейтинги, которые конвертируются в числовые scores:

| Facebook Ranking | Score |
|-----------------|-------|
| ABOVE_AVERAGE | +2 |
| AVERAGE | 0 |
| BELOW_AVERAGE | -1 |
| BELOW_AVERAGE_20 | -2 |
| BELOW_AVERAGE_35 | -3 |

**Relevance Health** = quality_score + engagement_score + conversion_score

Диапазон: от -9 (все BELOW_AVERAGE_35) до +6 (все ABOVE_AVERAGE)

### Z-Score нормализация

```
z_score = (value - mean) / std_dev
```

- Вычисляется по всем ads аккаунта за последние 12 недель
- Позволяет сравнивать метрики между разными аккаунтами
- Аномалия = |z_score| > 2.0 (2 стандартных отклонения)

### Детекция аномалий

Типы аномалий и пороги:

| Тип | Условие | Severity |
|-----|---------|----------|
| ctr_drop | CTR delta < -20% | high |
| ctr_crash | CTR delta < -40% | critical |
| cpr_spike | CPR delta > +30% | high |
| cpr_spike | CPR delta > +50% | critical |
| frequency_spike | Freq delta > +40% | medium |
| frequency_critical | Freq > 4.0 | high |
| reach_drop | Reach delta < -30% | medium |

### Decay Prediction (Прогноз выгорания)

Использует взвешенную сумму нормализованных features:

```typescript
const DECAY_WEIGHTS = {
  freq_delta_t: 0.20,      // рост частоты → decay
  ctr_delta_t: -0.25,      // падение CTR → decay
  cpc_delta_t: 0.15,       // рост CPC → decay
  freq_slope_t: 0.15,      // тренд частоты вверх → decay
  ctr_slope_t: -0.20,      // тренд CTR вниз → decay
  reach_growth_t: -0.15,   // падение охвата → decay
  spend_change_t: 0.05,    // рост бюджета может ускорить decay
  quality_score: -0.10,    // низкий quality → decay
  engagement_score: -0.10, // низкий engagement → decay
};

burnout_score = sigmoid(Σ weight_i × normalized_feature_i)
```

**Уровни:**
- `low`: score < 0.3
- `medium`: 0.3 ≤ score < 0.5
- `high`: 0.5 ≤ score < 0.7
- `critical`: score ≥ 0.7

### Recovery Prediction (Прогноз восстановления)

Обратные веса относительно decay:

```typescript
const RECOVERY_WEIGHTS = {
  freq_delta_t: -0.20,     // снижение частоты → recovery
  ctr_delta_t: 0.25,       // рост CTR → recovery
  cpc_delta_t: -0.15,      // снижение CPC → recovery
  freq_slope_t: -0.15,     // негативный тренд частоты → recovery
  ctr_slope_t: 0.20,       // позитивный тренд CTR → recovery
  reach_growth_t: 0.15,    // рост охвата → recovery
  spend_change_t: -0.05,   // снижение бюджета может помочь recovery
  quality_score: 0.10,     // высокий quality → recovery
  engagement_score: 0.10,  // высокий engagement → recovery
};
```

**Применяется только к ads со статусом:**
- `degraded` — умеренные проблемы (CPR +15-30%, CTR -10-20%)
- `burned_out` — серьёзные проблемы (CPR > +30%, CTR < -20%)

**Уровни:**
- `unlikely`: score < 0.3
- `possible`: 0.3 ≤ score < 0.5
- `likely`: 0.5 ≤ score < 0.7
- `very_likely`: score ≥ 0.7

### Lead-Lag Analysis

Определяет какие метрики предсказывают изменения CPR:

1. Для каждой пары (lead_metric, cpr) вычисляем корреляцию при разных лагах (1-4 недели)
2. Находим оптимальный лаг с максимальной корреляцией
3. Сохраняем статистику для калибровки весов

Типичные результаты:
- `frequency` leads `cpr` by 1-2 weeks (correlation 0.4-0.6)
- `ctr` leads `cpr` by 1 week (negative correlation -0.3 to -0.5)

### Tracking Health Score

```
health_score = 100 - (issues_penalty)

issues_penalty:
- clicks_no_results: -20 points
- results_dropped: -15 points
- high_volatility: -10 points
```

**Статусы:**
- `healthy`: score ≥ 80
- `warning`: 50 ≤ score < 80
- `critical`: score < 50

---

## Использование

### Первичная настройка

1. Применить миграции:
```sql
-- migrations/106_ad_insights_weekly.sql
-- migrations/107_ad_insights_iteration2.sql
```

2. Первый sync для аккаунта:
```bash
curl -X POST "https://api.example.com/admin/ad-insights/act_123456/sync?weeks=12" \
  -H "x-user-id: admin-user-id"
```

### Регулярный мониторинг

Рекомендуемый workflow:

1. **Еженедельно** — запуск sync:
```bash
curl -X POST "https://api.example.com/admin/ad-insights/act_123456/sync?weeks=1"
```

2. **Проверка аномалий**:
```bash
curl "https://api.example.com/admin/ad-insights/act_123456/anomalies?severity=high"
```

3. **Проверка burnout predictions**:
```bash
curl "https://api.example.com/admin/ad-insights/act_123456/burnout/predictions?minScore=0.5"
```

4. **Decay + Recovery анализ**:
```bash
curl "https://api.example.com/admin/ad-insights/act_123456/decay-recovery"
```

### Годовой аудит

```bash
curl "https://api.example.com/admin/ad-insights/act_123456/yearly/audit?year=2024"
```

### Cron Jobs

Рекомендуемые cron задачи:

```bash
# Еженедельная синхронизация (понедельник 6:00)
0 6 * * 1 curl -X POST "https://api.example.com/admin/ad-insights/act_123456/sync?weeks=1"

# Ежедневная проверка anomalies (9:00)
0 9 * * * curl "https://api.example.com/admin/ad-insights/act_123456/anomalies?severity=high"
```

---

## Troubleshooting

### Частые проблемы

**1. Sync fails с rate limit error**
- Facebook API имеет лимиты
- Решение: уменьшить `weeks` параметр или добавить задержку

**2. Недостаточно данных для prediction**
- Требуется минимум 4 недели данных
- Требуется минимум 5 результатов в неделю (`min_results_met`)

**3. Anomalies не обнаружены**
- Проверить что sync завершился успешно
- Проверить что есть достаточно исторических данных для z-score

**4. Recovery predictions пустые**
- Recovery работает только для `degraded` и `burned_out` ads
- Если все ads `healthy`, predictions не генерируются

### Логирование

```typescript
// Включить debug логи
process.env.LOG_LEVEL = 'debug';
```

---

## Roadmap

### Planned features

- [ ] ML-модели вместо rule-based detection
- [ ] Real-time webhooks для критических аномалий
- [ ] Автоматические рекомендации по оптимизации
- [ ] A/B тест интеграция
- [ ] Creative fatigue detection по image hashes
- [ ] Audience overlap analysis
