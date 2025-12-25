# Ad Insights System

Система аналитики Meta Ads для tech_admin. Предоставляет глубокий анализ эффективности рекламы, детекцию аномалий, прогнозирование выгорания и годовые отчёты.

## Архитектура

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
│  AdminAdInsights.tsx → adInsightsApi.ts → types/adInsights.ts               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENT-SERVICE                                      │
│  routes/adInsights.ts                                                        │
│      │                                                                       │
│      ├── services/adInsightsSync.ts      (синхронизация данных)             │
│      ├── services/resultNormalizer.ts    (нормализация результатов)         │
│      ├── services/anomalyDetector.ts     (детекция аномалий)                │
│      ├── services/burnoutAnalyzer.ts     (прогноз выгорания/восстановления) │
│      ├── services/yearlyAnalyzer.ts      (годовые отчёты)                   │
│      └── services/trackingHealth.ts      (анализ трекинга)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SUPABASE                                        │
│  meta_insights_weekly, meta_insights_daily, meta_weekly_results,            │
│  ad_weekly_anomalies, ad_weekly_features, ad_burnout_predictions,           │
│  lag_dependency_stats, yearly_audit_cache                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## База данных

### Основные таблицы

#### `meta_insights_weekly`
Weekly агрегированные insights с Meta API.

```sql
CREATE TABLE meta_insights_weekly (
    id UUID PRIMARY KEY,
    ad_account_id UUID NOT NULL,
    user_account_id UUID,
    fb_ad_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,
    impressions INTEGER,
    clicks INTEGER,
    link_clicks INTEGER,
    spend DECIMAL(12,2),
    reach INTEGER,
    frequency DECIMAL(6,3),
    ctr DECIMAL(6,4),
    cpc DECIMAL(10,4),
    cpm DECIMAL(10,4),
    link_ctr DECIMAL(8,6),           -- CTR по ссылкам (Migration 113)
    actions_json JSONB,
    quality_rank_score DECIMAL(5,2),
    engagement_rank_score DECIMAL(5,2),
    conversion_rank_score DECIMAL(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ad_account_id, fb_ad_id, week_start_date)
);
```

#### `meta_weekly_results`
Нормализованные результаты по семействам (messages, leads, purchases, etc.).

```sql
CREATE TABLE meta_weekly_results (
    id UUID PRIMARY KEY,
    ad_account_id UUID NOT NULL,
    user_account_id UUID,
    fb_ad_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,
    result_family TEXT NOT NULL,  -- 'messages', 'leads', 'purchases', etc.
    result_count INTEGER,
    spend DECIMAL(12,2),
    cpr DECIMAL(10,4),            -- cost per result
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ad_account_id, fb_ad_id, week_start_date, result_family)
);
```

#### `ad_weekly_anomalies`
Детектированные аномалии CPR с анализом предшествующих отклонений.

```sql
CREATE TABLE ad_weekly_anomalies (
    id UUID PRIMARY KEY,
    ad_account_id UUID NOT NULL,
    user_account_id UUID,
    fb_ad_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,
    result_family TEXT NOT NULL,
    anomaly_type TEXT NOT NULL,      -- 'cpr_spike' (основной тип)
    severity TEXT NOT NULL,          -- 'low', 'medium', 'high', 'critical'
    current_value DECIMAL(12,4),
    baseline_value DECIMAL(12,4),
    delta_pct DECIMAL(8,2),
    anomaly_score DECIMAL(5,3),
    confidence DECIMAL(4,3),
    likely_triggers JSONB,           -- триггеры на текущей неделе
    preceding_deviations JSONB,      -- отклонения за 1-2 недели до (Migration 113)
    status TEXT DEFAULT 'new',       -- 'new', 'acknowledged', 'resolved'
    spike_pct DECIMAL(8,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    UNIQUE(ad_account_id, fb_ad_id, week_start_date, result_family, anomaly_type)
);
```

#### `ad_burnout_predictions` (Migration 110)
Прогнозы выгорания объявлений.

```sql
CREATE TABLE ad_burnout_predictions (
    id UUID PRIMARY KEY,
    ad_account_id UUID NOT NULL,
    user_account_id UUID,
    fb_ad_id TEXT NOT NULL,
    ad_name TEXT,
    result_family TEXT NOT NULL DEFAULT 'all',
    burnout_score DECIMAL(4,3),      -- 0.0-1.0
    burnout_level TEXT,              -- 'low', 'medium', 'high', 'critical'
    days_until_burnout INTEGER,
    confidence DECIMAL(4,3),
    contributing_factors JSONB,
    weekly_trend JSONB,
    recommendation TEXT,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ad_account_id, fb_ad_id, result_family)
);
```

#### `lag_dependency_stats` (Migration 111)
Статистика лаговых зависимостей для прогнозирования.

```sql
CREATE TABLE lag_dependency_stats (
    id UUID PRIMARY KEY,
    ad_account_id UUID NOT NULL,
    user_account_id UUID,
    result_family TEXT NOT NULL DEFAULT 'all',
    metric_name TEXT NOT NULL,
    prediction_type TEXT DEFAULT 'burnout',
    corr_lag_1w DECIMAL(5,4),
    corr_lag_2w DECIMAL(5,4),
    avg_cpr_growth_when_triggered DECIMAL(8,2),
    trigger_frequency DECIMAL(4,3),
    predictive_power DECIMAL(4,3),
    recommended_threshold DECIMAL(6,3),
    time_lag_weeks INTEGER DEFAULT 2,
    quantile_analysis JSONB,
    sample_size INTEGER DEFAULT 0,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ad_account_id, result_family, metric_name)
);
```

#### `yearly_audit_cache`
Кэш годовых аудитов.

```sql
CREATE TABLE yearly_audit_cache (
    id UUID PRIMARY KEY,
    ad_account_id UUID NOT NULL,
    result_family TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    top_ads_by_spend JSONB,
    top_ads_by_results JSONB,
    top_ads_by_efficiency JSONB,
    pareto_top10_pct DECIMAL(5,2),
    worst_cpr_weeks JSONB,
    best_cpr_weeks JSONB,
    zero_result_spend DECIMAL(12,2),
    zero_result_weeks INTEGER,
    anomaly_free_weeks_pct DECIMAL(5,2),
    total_spikes INTEGER,
    avg_spike_pct DECIMAL(8,2),
    total_spend DECIMAL(14,2),
    total_results INTEGER,
    avg_cpr DECIMAL(10,4),
    median_cpr DECIMAL(10,4),
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ad_account_id, result_family, period_start, period_end)
);
```

## API Endpoints

Все endpoints требуют `x-user-id` header с ID tech_admin пользователя.

### Синхронизация

#### `POST /admin/ad-insights/:accountId/sync`
Полная синхронизация данных Meta Ads.

**Query параметры:**
- `weeks` (number, default: 12) - количество недель для синхронизации
- `includeCampaigns` (boolean) - включить синхронизацию кампаний
- `includeAdsets` (boolean) - включить синхронизацию адсетов

**Response:**
```json
{
  "success": true,
  "accountId": "uuid",
  "insightsCount": 1383,
  "resultsCount": 3948,
  "anomaliesCount": 45,
  "burnoutPredictions": 51,
  "lagStats": 1
}
```

### Аномалии

#### `GET /admin/ad-insights/:accountId/anomalies`
Получить список аномалий.

**Query параметры:**
- `severity` - 'low', 'medium', 'high', 'critical'
- `type` - 'cpr_spike', 'zero_results', 'performance_drop'
- `limit` (number, optional) - лимит записей (без лимита по умолчанию)
- `offset` (number, default: 0) - сдвиг для пагинации
- `acknowledged` (boolean) - фильтр по статусу

**Response:**
```json
{
  "anomalies": [
    {
      "id": "uuid",
      "ad_account_id": "uuid",
      "fb_ad_id": "120215...",
      "week_start_date": "2025-12-16",
      "anomaly_type": "cpr_spike",
      "severity": "high",
      "current_value": 12.50,
      "baseline_value": 5.00,
      "delta_pct": 150.00,
      "anomaly_score": 0.85,
      "confidence": 0.92,
      "status": "new"
    }
  ],
  "total": 45
}
```

#### `POST /admin/ad-insights/:accountId/anomalies/:anomalyId/acknowledge`
Подтвердить (скрыть) аномалию.

#### `POST /admin/ad-insights/:accountId/enrich-daily-breakdown`
Обогатить аномалии детализацией по дням. Работает только с данными из БД (не делает запросы к Facebook API).

**Query параметры:**
- `forceRefresh` (boolean, default: false) - пересчитать даже если уже есть
- `limit` (number, optional) - лимит аномалий для обработки

**Response:**
```json
{
  "success": true,
  "enriched": 45,
  "skipped": 5,
  "errors": 0
}
```

### Burnout Predictions

#### `GET /admin/ad-insights/:accountId/burnout/predictions`
Получить прогнозы выгорания.

**Query параметры:**
- `minScore` (number, 0-1) - минимальный burnout score
- `level` - 'low', 'medium', 'high', 'critical'
- `limit` (number, default: 50)

**Response:**
```json
{
  "predictions": [
    {
      "id": "uuid",
      "fb_ad_id": "120215...",
      "ad_name": "Новый зуб за 2500",
      "burnout_score": 0.75,
      "burnout_level": "high",
      "days_until_burnout": 14,
      "confidence": 0.88,
      "contributing_factors": {
        "cpr_trend": "increasing",
        "frequency_saturation": 0.6,
        "creative_fatigue": 0.7
      },
      "weekly_trend": [...],
      "recommendation": "Рекомендуется обновить креатив"
    }
  ],
  "total": 51
}
```

#### `GET /admin/ad-insights/:accountId/burnout/lag-stats`
Получить статистику лаговых зависимостей.

**Response:**
```json
{
  "stats": [
    {
      "metric_name": "cpr_growth",
      "corr_lag_1w": 0.72,
      "corr_lag_2w": 0.85,
      "avg_cpr_growth_when_triggered": 45.5,
      "trigger_frequency": 0.23,
      "predictive_power": 0.78,
      "recommended_threshold": 1.5,
      "time_lag_weeks": 2
    }
  ]
}
```

### Decay & Recovery

#### `GET /admin/ad-insights/:accountId/decay-recovery`
Комбинированный анализ деградации и восстановления.

**Response:**
```json
{
  "decay": {
    "highRiskAds": [
      {
        "fbAdId": "120215...",
        "adName": "Название",
        "riskScore": 0.85,
        "riskLevel": "critical"
      }
    ]
  },
  "recovery": {
    "likelyRecoveryAds": [
      {
        "fbAdId": "120216...",
        "adName": "Название",
        "recoveryScore": 0.72,
        "recoveryLevel": "likely",
        "currentStatus": "degraded"
      }
    ]
  }
}
```

### Yearly Analysis

#### `GET /admin/ad-insights/:accountId/yearly/audit`
Годовой аудит (Pareto, waste, stability).

**Query параметры:**
- `family` (string, default: 'messages') - семейство результатов
- `periodStart` (date) - начало периода
- `periodEnd` (date) - конец периода

**Response:**
```json
{
  "success": true,
  "period": {
    "start": "2024-12-23",
    "end": "2025-12-23"
  },
  "totals": {
    "spend": 92303.40,
    "results": 15970,
    "avgCpr": 5.78,
    "medianCpr": 4.67,
    "weeks": 53
  },
  "pareto": {
    "top10PctAds": [...],
    "top10PctContribution": 68.5,
    "bottom50PctSpend": 12500.00
  },
  "bestWeeks": [
    { "week": "2025-03-10", "cpr": 3.20, "spend": 1500, "results": 469 }
  ],
  "worstWeeks": [
    { "week": "2025-08-05", "cpr": 9.80, "spend": 2100, "results": 214 }
  ],
  "waste": {
    "zeroResultSpend": 0,
    "zeroResultWeeks": 0,
    "zeroResultAds": []
  },
  "stability": {
    "anomalyFreeWeeksPct": 100,
    "totalSpikes": 0,
    "avgSpikePct": 0
  }
}
```

#### `GET /admin/ad-insights/:accountId/yearly/creatives`
Анализ жизненного цикла креативов.

#### `GET /admin/ad-insights/:accountId/yearly/waste`
Детальный анализ потерь бюджета.

### Tracking Health

#### `GET /admin/ad-insights/:accountId/tracking-health`
Анализ здоровья трекинга.

**Response:**
```json
{
  "overallHealth": 95,
  "issues": [
    {
      "type": "clicks_no_results",
      "severity": "warning",
      "adId": "120215...",
      "description": "Клики без конверсий"
    }
  ]
}
```

### Cross-Account Patterns (Паттерны аномалий)

Анализ паттернов CPR аномалий по всем аккаунтам. Не требует выбора конкретного аккаунта.

#### `GET /admin/ad-insights/patterns/summary`
Общая статистика паттернов.

**Response:**
```json
{
  "total_anomalies": 606,
  "total_eligible_weeks": 14500,
  "overall_anomaly_rate": 4.18,
  "top_month": {
    "bucket": "2025-03",
    "anomaly_rate": 6.2,
    "anomaly_count": 45
  },
  "top_precursors": [
    {
      "metric": "frequency",
      "week_offset": "week_minus_1",
      "significant_pct": 72,
      "avg_delta_pct": 38.5,
      "direction": "bad"
    }
  ],
  "family_breakdown": [
    {
      "result_family": "messages",
      "eligible_count": 8500,
      "anomaly_count": 380,
      "anomaly_rate": 4.47
    }
  ],
  "account_breakdown": [
    {
      "account_id": "uuid",
      "fb_account_id": "act_123456",
      "account_name": "Main Account",
      "anomaly_count": 120,
      "pct_of_total": 19.8
    }
  ],
  "period": {
    "from": "2024-01-01",
    "to": "2025-12-23"
  }
}
```

#### `GET /admin/ad-insights/patterns/seasonality`
Сезонность аномалий (anomaly rate по месяцам/неделям).

**Query параметры:**
- `granularity` - 'month' | 'week' (default: 'month')

**Response:**
```json
{
  "buckets": [
    {
      "bucket": "2025-03",
      "eligible_count": 1200,
      "anomaly_count": 45,
      "anomaly_rate": 3.75,
      "avg_delta_pct": 42.5,
      "is_elevated": true
    }
  ],
  "summary": {
    "total_eligible": 14500,
    "total_anomalies": 606,
    "avg_rate": 4.18,
    "rate_stddev": 1.2
  }
}
```

#### `GET /admin/ad-insights/patterns/metrics`
Статистика метрик-виновников по неделям.

**Response:**
```json
{
  "week_0": [
    {
      "metric": "frequency",
      "occurrences": 606,
      "significant_count": 515,
      "significant_pct": 85,
      "avg_delta_pct": 42.3,
      "direction_breakdown": {
        "bad": 480,
        "good": 20,
        "neutral": 15
      }
    }
  ],
  "week_minus_1": [...],
  "week_minus_2": [...],
  "total_anomalies": 606
}
```

## Frontend

### Компоненты

#### `AdminAdInsights.tsx`
Основная страница с вкладками:
- **Anomalies** - таблица аномалий с возможностью acknowledge
- **Burnout** - карточки прогнозов выгорания
- **Decay/Recovery** - анализ деградации и восстановления
- **Yearly** - годовой аудит (Pareto, waste, stability)
- **Patterns** - cross-account анализ паттернов аномалий (не требует выбора аккаунта)

#### Patterns Components (`components/ad-insights/patterns/`)

| Компонент | Описание |
|-----------|----------|
| `SeasonalityChart.tsx` | Bar chart anomaly_rate по месяцам/неделям с baseline линией |
| `MetricsHeatmap.tsx` | Таблица-heatmap: Metric × Week (0/-1/-2) → significant_pct |
| `PrecursorsCard.tsx` | Топ-10 метрик-предвестников (week_-1, week_-2) |
| `FamilyBreakdown.tsx` | Breakdown аномалий по result_family |
| `AccountBreakdown.tsx` | Breakdown аномалий по ad accounts |
| `PatternsFilters.tsx` | Фильтры: granularity, period |

#### `AnomaliesTable.tsx`
Таблица аномалий с колонками:
- Ad ID / Name
- Тип аномалии
- Severity
- Current Value / Baseline
- Delta %
- Статус
- Действия (Acknowledge)

#### `BurnoutCard.tsx`
Карточка прогноза выгорания:
- Burnout Score (индикатор 0-100%)
- Burnout Level (low/medium/high/critical)
- Days Until Burnout
- Contributing Factors
- Recommendation

### API Client (`adInsightsApi.ts`)

```typescript
const adInsightsApi = {
  // Синхронизация
  sync(accountId, options?): Promise<SyncResponse>,

  // Аномалии
  getAnomalies(accountId, options?): Promise<AnomaliesResponse>,
  acknowledgeAnomaly(accountId, anomalyId): Promise<boolean>,

  // Burnout
  getBurnoutPredictions(accountId, options?): Promise<BurnoutPredictionsResponse>,
  getLagStats(accountId): Promise<LagDependencyStat[]>,

  // Recovery
  getRecoveryPredictions(accountId): Promise<RecoveryPredictionsResponse>,
  getDecayRecoveryAnalysis(accountId): Promise<DecayRecoveryResponse>,

  // Yearly
  getYearlyAudit(accountId, year?): Promise<YearlyAudit | null>,

  // Tracking
  getTrackingHealth(accountId): Promise<TrackingHealthResponse | null>,

  // Dashboard
  getDashboardStats(accountId): Promise<AdInsightsDashboardStats | null>,
};
```

### Трансформации данных

API возвращает данные в camelCase формате, frontend ожидает snake_case. Трансформации выполняются в `adInsightsApi.ts`:

#### Decay/Recovery
```typescript
// API возвращает:
{ decay: { highRiskAds: [...] }, recovery: { likelyRecoveryAds: [...] } }

// Трансформируется в:
{ analysis: DecayRecoveryAnalysis[] }
```

#### Yearly Audit
```typescript
// API возвращает:
{
  pareto: { top10PctAds, top10PctContribution, bottom50PctSpend },
  stability: { anomalyFreeWeeksPct, totalSpikes, avgSpikePct },
  waste: { zeroResultSpend, zeroResultWeeks, zeroResultAds }
}

// Трансформируется в:
{
  pareto: { top20pct_ads, top20pct_results_share, bottom80pct_ads },
  stability: { avgWeeklyVariation, maxDrawdown, consistentWeeks },
  waste: { zeroResultsSpend, highCprSpend, totalWaste, wastePercentage }
}
```

## Сервисы

### `adInsightsSync.ts`
Синхронизация данных с Meta API:
- `fullSync()` - полная синхронизация (insights + campaigns + adsets + ads)
- `syncWeeklyInsights()` - синхронизация weekly insights
- `syncCampaigns()` / `syncAdsets()` / `syncAds()` - синхронизация сущностей

### `resultNormalizer.ts`
Нормализация результатов из `actions_json` в семейства.

**ВАЖНО:** Используется ОДИН action_type на категорию для избежания дублирования (аналогично логике для обычных пользователей в facebookApi.ts):

- `messages` - `onsite_conversion.total_messaging_connection` (только этот!)
- `leadgen_form` - `onsite_conversion.lead_grouped` (только этот!)
- `website_lead` - `offsite_conversion.fb_pixel_lead`, `fb_pixel_complete_registration`
- `purchase` - `offsite_conversion.fb_pixel_purchase`
- `click` - `link_click`, `landing_page_view`

**НЕ используются** (дублируют другие action types):
- `lead` - агрегат, дублирует `lead_grouped`
- `messaging_conversation_started_7d` - дублирует `total_messaging_connection`
- `messaging_first_reply` - дублирует `total_messaging_connection`

### `anomalyDetector.ts`
Детекция аномалий CPR с анализом предшествующих отклонений:

**Фокус только на CPR spike** (рост стоимости результата ≥20% от baseline).

Для каждой аномалии анализируются **3 недели:**
- `week_0` - **неделя аномалии** (текущая неделя с CPR spike)
- `week_minus_1` - неделя перед аномалией
- `week_minus_2` - 2 недели до аномалии

**Performance метрики (с порогами отклонений):**
- `frequency` - рост частоты показов (порог 15%)
- `ctr` - падение CTR (порог 15%)
- `link_ctr` - падение CTR по ссылкам (порог 15%)
- `cpm` - рост CPM (порог 15%)
- `spend` - рост расхода (порог 30%)
- `results` - падение количества результатов (порог 20%)

**Ad Relevance Diagnostics (качество креатива):**
Для каждой недели отображаются **raw values** рейтингов (без порогов):
- `quality_ranking` - оценка качества креатива
- `engagement_ranking` - вовлечённость аудитории
- `conversion_ranking` - конверсионность креатива

**Значения ranking scores от Facebook:**
- `+2` = Above Average (зелёный)
- `0` = Average (жёлтый)
- `-1`, `-2`, `-3` = Below Average (красный)

**Направление отклонений:**
| Метрика | Плохо (красный) | Хорошо (зелёный) |
|---------|-----------------|------------------|
| frequency | Рост ≥15% | Падение ≥15% |
| ctr | Падение ≥15% | Рост ≥15% |
| link_ctr | Падение ≥15% | Рост ≥15% |
| cpm | Рост ≥15% | Падение ≥15% |
| spend | Рост ≥30% | (не отмечаем) |
| results | Падение ≥20% | Рост ≥20% |

**Структура `preceding_deviations` (JSONB):**
```json
{
  "week_0": {
    "week_start": "2025-12-16",
    "week_end": "2025-12-22",
    "deviations": [
      {"metric": "results", "value": 10, "baseline": 15, "delta_pct": -33.3, "is_significant": true, "direction": "bad"}
    ],
    "quality_ranking": 2,
    "engagement_ranking": 0,
    "conversion_ranking": -1
  },
  "week_minus_1": {
    "week_start": "2025-12-09",
    "week_end": "2025-12-15",
    "deviations": [
      {"metric": "frequency", "value": 4.2, "baseline": 2.8, "delta_pct": 50.0, "is_significant": true, "direction": "bad"}
    ],
    "quality_ranking": 2,
    "engagement_ranking": 2,
    "conversion_ranking": 0
  },
  "week_minus_2": { ... }
}
```

### `dailyBreakdownEnricher.ts`
Обогащение аномалий детализацией по дням:

**Функция `enrichDailyBreakdown(adAccountId, options)`:**
- Загружает аномалии где `daily_breakdown IS NULL` (или все при `forceRefresh=true`)
- Для каждой аномалии:
  - Читает `meta_insights_daily` за неделю аномалии
  - Вычисляет CPR для каждого дня
  - Сравнивает с week_avg для определения deviations
  - Определяет worst/best дни по CPR
- Batch update аномалий с `daily_breakdown` JSONB
- Если данных нет в БД — подгружает из Facebook API (async job)

**Метрики по дням:**
- `impressions`, `spend`, `results` — базовые
- `frequency = impressions / reach`
- `ctr = clicks / impressions * 100`
- `link_ctr = link_clicks / impressions * 100`
- `cpm = spend / impressions * 1000`
- `cpr = spend / results`

**Пороги значимости отклонений:**
| Метрика | Порог | Плохо | Хорошо |
|---------|-------|-------|--------|
| cpr | 15% | Рост | Падение |
| frequency | 15% | Рост | Падение |
| ctr | 15% | Падение | Рост |
| link_ctr | 15% | Падение | Рост |
| cpm | 15% | Рост | Падение |
| spend | 30% | Рост | — |
| results | 20% | Падение | Рост |

### `burnoutAnalyzer.ts`
Прогнозирование выгорания:
- Quantile analysis по CPR тренду
- Lag dependency correlations
- Burnout score (0-1) на основе множества факторов
- Recovery predictions

### `yearlyAnalyzer.ts`
Годовые отчёты:
- Pareto analysis (80/20 rule)
- Best/Worst weeks
- Waste analysis
- Stability metrics
- Creative lifecycle
- Goal drift

## Миграции

### Migration 110: `ad_burnout_predictions`
Таблицы для прогнозов выгорания.

### Migration 111: `fix_lag_dependency_stats`
Исправление схемы `lag_dependency_stats` с правильными колонками.

### Migration 113: `cpr_preceding_deviations`
Система анализа предшествующих отклонений для CPR аномалий:
- Новые колонки в `ad_weekly_features`: `cpm_lag1/2`, `spend_lag1/2`, `link_ctr`, `link_ctr_lag1/2`, `baseline_cpm/spend/link_ctr`, `cpm/spend/link_ctr_delta_pct`
- Новая колонка в `ad_weekly_anomalies`: `preceding_deviations` (JSONB)
- Новая колонка в `meta_insights_weekly`: `link_ctr`

### Migration 114: `ranking_deviations`
Добавление лагов для Ad Relevance Diagnostics (качество креатива):
- Новые колонки в `ad_weekly_features`:
  - `quality_rank_lag1`, `quality_rank_lag2` - лаги качества
  - `engagement_rank_lag1`, `engagement_rank_lag2` - лаги вовлечённости
  - `conversion_rank_lag1`, `conversion_rank_lag2` - лаги конверсионности

### Migration 115: `daily_insights_pause_detection`
Детекция пауз в доставке рекламы на уровне дней:

**Новая таблица `meta_insights_daily`:**
```sql
CREATE TABLE meta_insights_daily (
    id UUID PRIMARY KEY,
    ad_account_id UUID NOT NULL,
    fb_ad_id TEXT NOT NULL,
    date DATE NOT NULL,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    spend DECIMAL(12,2) DEFAULT 0,
    reach INTEGER DEFAULT 0,
    ctr DECIMAL(6,4),
    cpm DECIMAL(10,4),
    cpc DECIMAL(10,4),
    results_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ad_account_id, fb_ad_id, date)
);
```

**Новые колонки в `ad_weekly_anomalies`:**
- `pause_days_count` - количество дней с нулевыми impressions
- `has_delivery_gap` - флаг наличия значительной паузы в доставке

**Новые колонки в `ad_weekly_features`:**
- `active_days` - количество дней с impressions > 0 (из 7)
- `min_daily_impressions` - минимальные impressions за день
- `max_daily_impressions` - максимальные impressions за день
- `daily_impressions_cv` - коэффициент вариации (std/mean)

**Логика детекции пауз:**
- Если spend > 0, но impressions = 0 → вероятная пауза (неоплата, модерация, лимиты)
- Delivery gap = есть дни с impressions и дни без impressions в одной неделе
- Высокий CV указывает на нестабильную доставку

### Migration 116-118: Baseline columns
Добавление baseline колонок для всех метрик:

**Migration 116:** `baseline_conversion` для ranking deviations
**Migration 117:** `baseline_quality`, `baseline_engagement` для Ad Relevance
**Migration 118:** Все остальные baseline колонки:
- `baseline_frequency`, `baseline_ctr`, `baseline_cpc`, `baseline_cpm`
- `baseline_spend`, `baseline_link_ctr`, `baseline_results`

### Migration 119: `add_missing_feature_columns`
Добавление недостающих колонок для полного набора features:
- `results_delta_pct` - дельта результатов vs baseline
- `results_lag1`, `results_lag2` - лаги результатов
- `link_ctr`, `link_ctr_delta_pct` - Link CTR и его дельта

### Migration 120-121: `fix_decimal_precision`
Исправление precision для полей которые могут превышать 100%:
- Все `*_delta_pct` поля: `DECIMAL(12,4)` (было `DECIMAL(8,2)`)
- `reach_growth_rate`, `freq_slope`, `ctr_slope`: увеличен precision
- Добавлены недостающие lag колонки: `cpm_lag1/2`, `spend_lag1/2`, `link_ctr_lag1/2`

### Migration 122: `fix_ranking_drops_to_decimal`
Изменение типа ranking drop колонок с SMALLINT на DECIMAL:
```sql
ALTER TABLE ad_weekly_features
ALTER COLUMN quality_drop TYPE DECIMAL(3,1),
ALTER COLUMN engagement_drop TYPE DECIMAL(3,1),
ALTER COLUMN conversion_drop TYPE DECIMAL(3,1),
ALTER COLUMN relevance_drop TYPE DECIMAL(4,1);
```
**Причина:** baseline для rankings - это медиана (может быть 1.5), поэтому drop = score - baseline может быть дробным.

### Migration 123: `daily_breakdown_enhancement`
Расширение daily insights и добавление daily_breakdown для аномалий:

**Расширение `meta_insights_daily`:**
```sql
ALTER TABLE meta_insights_daily
ADD COLUMN IF NOT EXISTS frequency DECIMAL(8,4),
ADD COLUMN IF NOT EXISTS link_clicks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS link_ctr DECIMAL(8,6),
ADD COLUMN IF NOT EXISTS actions_json JSONB;
```

**Добавление `daily_breakdown` в `ad_weekly_anomalies`:**
```sql
ALTER TABLE ad_weekly_anomalies
ADD COLUMN IF NOT EXISTS daily_breakdown JSONB;
```

**Структура `daily_breakdown` (JSONB):**
```json
{
  "days": [
    {
      "date": "2025-01-06",
      "metrics": {
        "impressions": 1500,
        "spend": 25.50,
        "frequency": 1.8,
        "ctr": 2.1,
        "link_ctr": 1.5,
        "cpm": 17.00,
        "cpr": 5.10,
        "results": 5
      },
      "deviations": [
        {"metric": "cpr", "value": 5.10, "week_avg": 4.20, "delta_pct": 21.4, "direction": "bad"}
      ]
    }
  ],
  "summary": {
    "worst_day": "2025-01-08",
    "best_day": "2025-01-06",
    "active_days": 6,
    "pause_days": 1
  }
}
```

## Multi-Account Support

Система поддерживает multi-account архитектуру:
- `ad_account_id` - ID рекламного аккаунта (из `ad_accounts` таблицы)
- `user_account_id` - ID пользователя-владельца

Для legacy аккаунтов (без multi-account) используется прямой `ad_account_id`.

## Использование

### 1. Первоначальная настройка

```bash
# Применить миграции
psql < migrations/110_ad_burnout_predictions.sql
psql < migrations/111_fix_lag_dependency_stats.sql
```

### 2. Синхронизация данных

```bash
# Через API
curl -X POST "http://localhost:8082/admin/ad-insights/{accountId}/sync?weeks=52" \
  -H "x-user-id: {adminUserId}"
```

### 3. Просмотр данных

Открыть `/admin/ad-insights` в браузере (требуется авторизация tech_admin).

## Changelog

### 2025-12-25 (v5): Cross-Account Patterns Dashboard
- **НОВОЕ:** Таб "Паттерны" для cross-account анализа аномалий
  - Не требует выбора конкретного аккаунта
  - Анализирует все 606 CPR spike аномалий (только delta_pct > 0)
- **НОВОЕ:** API endpoints для паттернов
  - `GET /admin/ad-insights/patterns/summary` - общая статистика
  - `GET /admin/ad-insights/patterns/seasonality` - anomaly rate по месяцам/неделям
  - `GET /admin/ad-insights/patterns/metrics` - метрики-виновники по неделям
- **НОВОЕ:** Компоненты визуализации
  - `SeasonalityChart` - bar chart anomaly_rate с baseline и elevated buckets
  - `MetricsHeatmap` - таблица significant_pct по метрикам и неделям
  - `PrecursorsCard` - топ-10 метрик-предвестников (исключены results, cpr)
  - `FamilyBreakdown` - breakdown по result_family
  - `AccountBreakdown` - breakdown по ad accounts с именами
- **НОВОЕ:** Account names lookup
  - Для multi-account: из `ad_accounts.name`
  - Для legacy: из `user_accounts.username`
- **КЛЮЧЕВЫЕ ИНСАЙТЫ:**
  - Anomaly rate = anomalies / eligible_weeks (не просто count!)
  - Elevated buckets: rate > avg + 1σ
  - Предвестники: метрики week_-1 и week_-2, исключая results и cpr (следствия)

### 2025-12-25 (v4): Daily Breakdown для аномалий
- **НОВОЕ:** Детализация аномалий по дням недели
  - Для каждой аномалии (неделя + объявление) можно увидеть метрики по каждому дню
  - Метрики: impressions, spend, frequency, ctr, link_ctr, cpm, cpr, results
  - Определяются worst/best дни по CPR
  - Показываются значимые отклонения от среднего за неделю
- **НОВОЕ:** Расширение `meta_insights_daily` (миграция 123)
  - Добавлены поля: frequency, link_clicks, link_ctr, actions_json
  - Данные синхронизируются через syncDailyInsights()
- **НОВОЕ:** Сервис `dailyBreakdownEnricher.ts`
  - Обогащает аномалии детализацией по дням
  - Работает только с данными из БД (не делает запросы к Facebook API)
- **НОВОЕ:** Endpoint `POST /admin/ad-insights/:accountId/enrich-daily-breakdown`
  - Query параметры: `forceRefresh` (boolean), `limit` (number)
  - Возвращает: `{ success, enriched, skipped, errors }`
- **НОВОЕ:** UI компонент `DailyBreakdownTable`
  - Интегрирован в expanded row аномалий
  - Таблица с колонками: День, Spend, Impr, CTR, CPM, Results, CPR, Сигналы
  - Подсветка worst (красный) и best (зелёный) дней
  - Индикация pause дней
- **ТРЕБУЕТСЯ:**
  1. Применить миграцию 123
  2. Пересинхронизировать данные: `POST /admin/ad-insights/:accountId/sync`
  3. Обогатить аномалии: `POST /admin/ad-insights/:accountId/enrich-daily-breakdown`

### 2025-12-25 (v3): Complete Preceding Deviations + Schema Fixes
- **НОВОЕ:** On-the-fly baseline calculation
  - Если stored baselines = null, baseline вычисляется на лету из данных последних 8 недель
  - Решает проблему новых рекламных аккаунтов без исторических baselines
- **НОВОЕ:** Все 7 метрик показываются для всех 3 недель
  - Ранее показывались только значимые отклонения (>15%)
  - Теперь: frequency, ctr, link_ctr, cpm, cpr, spend, results — всегда присутствуют
  - CPR добавлен как отдельная метрика в preceding_deviations
- **ИСПРАВЛЕНО:** Schema fixes (миграции 116-122)
  - Добавлены все baseline колонки для метрик
  - Исправлен precision для delta полей (DECIMAL(12,4) вместо DECIMAL(8,2))
  - Добавлены недостающие lag колонки (cpm, spend, link_ctr)
  - Ranking drops изменены с SMALLINT на DECIMAL(3,1) для дробных значений
- **ИСПРАВЛЕНО:** weeklyData lookup
  - Исправлен поиск данных по ключу даты вместо lag columns
  - Корректно находит features для week_minus_1 и week_minus_2
- **ОБНОВЛЕНО:** UI таблицы аномалий
  - Все метрики показываются даже если delta = 0
  - Улучшена визуализация для полной картины состояния рекламы
- **ТРЕБУЕТСЯ:** Применить миграции 116-122, пересинхронизировать данные, запустить detect-anomalies и update-preceding-deviations

### 2025-12-24 (v2): Week 0 + Results Metric + Raw Rankings
- **НОВОЕ:** `week_0` добавлен в preceding_deviations
  - Неделя аномалии теперь отображается наряду с предшествующими неделями
  - Позволяет видеть отклонения непосредственно в неделю CPR spike
- **НОВОЕ:** Метрика `results` (количество результатов)
  - Порог значимости: 20%
  - Падение результатов = bad (красный)
- **НОВОЕ:** Raw ranking values в каждой неделе (week_0, week_-1, week_-2)
  - quality_ranking, engagement_ranking, conversion_ranking
  - Отображаются БЕЗ порогов, просто для информации
  - Цветовая индикация: +2=Above (зелёный), 0=Average (жёлтый), <0=Below (красный)
- **ИСПРАВЛЕНО:** Убран default limit=50 из endpoint anomalies
  - Теперь возвращаются все аномалии по умолчанию
- **ОБНОВЛЕНО:** UI таблицы - 3-колоночная сетка недель с rankings под каждой неделей

### 2025-12-24: Preceding Deviations System + Ad Relevance Diagnostics
- **НОВОЕ:** Система анализа предшествующих отклонений для CPR аномалий
  - Фокус только на CPR spike (убраны `ctr_drop`, `freq_high`)
  - Для каждой аномалии фиксируются отклонения метрик за 1-2 недели до
  - Performance метрики: frequency, CTR, link_ctr, CPM, spend
  - Пороги значимости: 15% (30% для spend)
  - Направление отклонений: bad/good/neutral
- **НОВОЕ:** Link CTR (CTR по ссылкам) как отдельная метрика
- **НОВОЕ:** Ad Relevance Diagnostics (качество креатива) в preceding deviations
  - `quality_ranking` - оценка качества креатива (Facebook)
  - `engagement_ranking` - вовлечённость аудитории
  - `conversion_ranking` - конверсионность креатива
  - Порог значимости: 20%
  - Падение = плохо, рост = хорошо
- **ОБНОВЛЕНО:** UI таблицы аномалий с expandable rows
  - Клик на строку раскрывает детали предшествующих отклонений
  - Недели отображаются как диапазон дат
  - Цветовая индикация: красный=плохо, зелёный=хорошо
  - Иконки для каждой метрики (★ качество, 👍 вовлечённость, 🎯 конверсии)
- **ТРЕБУЕТСЯ:** Применить миграции 113, 114 и пересинхронизировать данные

### 2025-12-23 (v2)
- **ИСПРАВЛЕНО:** Дублирование результатов в Yearly Audit
  - Убраны дублирующие action types из маппинга в `resultNormalizer.ts`
  - Теперь используется один action_type на категорию (как для обычных пользователей)
  - `messages` = только `total_messaging_connection`
  - `leadgen_form` = только `lead_grouped`
- **УЛУЧШЕНО:** Отображение недель в формате диапазона "15 дек — 21 дек"
- **ТРЕБУЕТСЯ:** Пересинхронизация данных после обновления

### 2025-12-23
- Исправлены форматы ответов API для соответствия frontend expectations
- Burnout predictions endpoint теперь читает из БД (snake_case)
- Добавлены трансформации в adInsightsApi.ts для decay-recovery и yearly-audit
- Обновлён Anomaly interface с правильными полями (current_value, baseline_value, delta_pct)
- Исправлен AnomaliesTable для использования правильных API полей
