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
│  meta_insights_weekly, meta_weekly_results, ad_weekly_anomalies,            │
│  ad_burnout_predictions, lag_dependency_stats, yearly_audit_cache           │
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
    spend DECIMAL(12,2),
    reach INTEGER,
    frequency DECIMAL(6,3),
    ctr DECIMAL(6,4),
    cpc DECIMAL(10,4),
    cpm DECIMAL(10,4),
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
Детектированные аномалии CPR.

```sql
CREATE TABLE ad_weekly_anomalies (
    id UUID PRIMARY KEY,
    ad_account_id UUID NOT NULL,
    user_account_id UUID,
    fb_ad_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,
    result_family TEXT NOT NULL,
    anomaly_type TEXT NOT NULL,      -- 'cpr_spike', 'zero_results', 'performance_drop'
    severity TEXT NOT NULL,          -- 'low', 'medium', 'high', 'critical'
    current_value DECIMAL(12,4),
    baseline_value DECIMAL(12,4),
    delta_pct DECIMAL(8,2),
    anomaly_score DECIMAL(5,3),
    confidence DECIMAL(4,3),
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
- `limit` (number, default: 50)
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

## Frontend

### Компоненты

#### `AdminAdInsights.tsx`
Основная страница с вкладками:
- **Anomalies** - таблица аномалий с возможностью acknowledge
- **Burnout** - карточки прогнозов выгорания
- **Decay/Recovery** - анализ деградации и восстановления
- **Yearly** - годовой аудит (Pareto, waste, stability)

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
Нормализация результатов из `actions_json` в семейства:
- `messages` - messaging_conversation_started_7d, onsite_conversion.messaging_*
- `leads` - lead, leadgen_grouped
- `purchases` - purchase, omni_purchase
- `registrations` - complete_registration
- `clicks` - link_click (fallback)

### `anomalyDetector.ts`
Детекция аномалий:
- CPR spikes (рост CPR > 2x от baseline)
- Zero results (spend без результатов)
- Performance drops (падение результатов)

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

### 2025-12-23
- Исправлены форматы ответов API для соответствия frontend expectations
- Burnout predictions endpoint теперь читает из БД (snake_case)
- Добавлены трансформации в adInsightsApi.ts для decay-recovery и yearly-audit
- Обновлён Anomaly interface с правильными полями (current_value, baseline_value, delta_pct)
- Исправлен AnomaliesTable для использования правильных API полей
