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
