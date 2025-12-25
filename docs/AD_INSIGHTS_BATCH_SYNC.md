# Ad Insights Batch Sync — Полная документация

> **Дата запуска:** 25 декабря 2025
> **Статус:** Completed
> **Обработано аккаунтов:** 174
> **Найдено аномалий:** 606
> **Burnout predictions:** 589

---

## 1. Обзор системы

### 1.1 Цель
Массовая синхронизация и анализ рекламных данных Facebook Ads для всех аккаунтов в системе с целью:
- Обнаружения аномалий CPR (Cost Per Result) — рост стоимости результата
- Предсказания выгорания объявлений (burnout predictions)
- Анализа предшествующих отклонений метрик перед аномалиями

### 1.2 Ключевые метрики
- **CPR (Cost Per Result)** — стоимость одного результата (лид, сообщение, покупка)
- **Frequency** — средняя частота показа на пользователя
- **CTR** — Click Through Rate
- **CPM** — Cost Per Mille (стоимость 1000 показов)
- **Quality Rankings** — оценки качества от Facebook (quality, engagement, conversion)

---

## 2. Архитектура процесса

### 2.1 Pipeline обработки одного аккаунта

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BATCH SYNC PIPELINE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌───────────────┐    ┌──────────────┐                  │
│  │   STEP 1     │    │    STEP 2     │    │   STEP 3     │                  │
│  │   fullSync   │───▶│  normalize    │───▶│  features +  │                  │
│  │              │    │  Results      │    │  anomalies   │                  │
│  └──────────────┘    └───────────────┘    └──────────────┘                  │
│        │                    │                    │                           │
│        ▼                    ▼                    ▼                           │
│  - Campaigns           - Группировка       - Baselines                      │
│  - AdSets               action_types      - Дельты vs baseline             │
│  - Ads                  по семействам     - Лаги (t-1, t-2)                │
│  - Weekly Insights     - CPR расчёт       - Slopes (тренды)                │
│  - Daily Insights      - Family detection - CPR spike detection            │
│                                                                              │
│  ┌──────────────┐    ┌───────────────┐                                      │
│  │   STEP 4     │    │    STEP 5     │                                      │
│  │   daily      │───▶│   burnout     │                                      │
│  │  enrichment  │    │  predictions  │                                      │
│  └──────────────┘    └───────────────┘                                      │
│        │                    │                                                │
│        ▼                    ▼                                                │
│  - Pause detection     - Risk scoring                                       │
│  - Daily breakdown     - Top drivers                                        │
│  - Delivery gaps       - Predicted CPR change                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Параллельная обработка

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          WORKER POOL ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Business Grouping                            │    │
│  │  Аккаунты группируются по business_id для соблюдения rate limits    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                   │                                          │
│           ┌───────────────────────┼───────────────────────┐                 │
│           ▼                       ▼                       ▼                 │
│     ┌──────────┐            ┌──────────┐            ┌──────────┐           │
│     │ Worker 1 │            │ Worker 2 │            │ Worker N │           │
│     │          │            │          │            │          │           │
│     │ Business │            │ Business │            │ Business │           │
│     │ Group A  │            │ Group B  │            │ Group Z  │           │
│     └──────────┘            └──────────┘            └──────────┘           │
│           │                       │                       │                 │
│           ▼                       ▼                       ▼                 │
│     [Account 1]             [Account 3]             [Account 5]            │
│     [Account 2]             [Account 4]             [Account 6]            │
│           │                       │                       │                 │
│           └───────────────────────┴───────────────────────┘                 │
│                                   │                                          │
│                          ┌────────▼────────┐                                │
│                          │   Shared Queue  │                                │
│                          │   + Progress    │                                │
│                          │   Tracking      │                                │
│                          └─────────────────┘                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Источники данных

### 3.1 Multi-account аккаунты
```sql
-- Таблица: ad_accounts
SELECT id, user_account_id, ad_account_id, business_id, access_token
FROM ad_accounts
WHERE access_token IS NOT NULL
  AND ad_account_id IS NOT NULL
```

### 3.2 Legacy аккаунты
```sql
-- Таблица: user_accounts (для пользователей без multi_account_enabled)
SELECT id, ad_account_id, access_token, username
FROM user_accounts
WHERE (multi_account_enabled IS NULL OR multi_account_enabled = false)
  AND access_token IS NOT NULL
  AND ad_account_id IS NOT NULL
  AND ad_account_id != ''
  AND ad_account_id LIKE 'act_%'
```

При обнаружении legacy аккаунта создаётся запись в `ad_accounts` для унификации.

---

## 4. Структура данных

### 4.1 Основные таблицы

| Таблица | Описание | Ключевые поля |
|---------|----------|---------------|
| `meta_campaigns` | Справочник кампаний | fb_campaign_id, objective, status |
| `meta_adsets` | Справочник групп объявлений | fb_adset_id, optimization_goal, targeting |
| `meta_ads` | Справочник объявлений | fb_ad_id, fb_creative_id, status |
| `meta_insights_weekly` | Недельные метрики | spend, frequency, ctr, cpm, reach, rankings |
| `meta_insights_daily` | Дневные метрики | impressions, spend, reach (для pause detection) |
| `meta_weekly_results` | Нормализованные результаты | result_family, result_count, cpr |
| `ad_weekly_features` | Вычисленные фичи | baselines, deltas, lags, slopes |
| `ad_weekly_anomalies` | Обнаруженные аномалии | anomaly_type, delta_pct, likely_triggers |
| `ad_burnout_predictions` | Прогнозы выгорания | risk_level, top_drivers, predicted_cpr_change |

### 4.2 Result Families (семейства результатов)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RESULT FAMILIES                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  messages        → onsite_conversion.total_messaging_connection              │
│  leadgen_form    → onsite_conversion.lead_grouped                           │
│  website_lead    → offsite_conversion.fb_pixel_lead                         │
│  purchase        → offsite_conversion.fb_pixel_purchase                     │
│  click           → link_click, landing_page_view                            │
│  video_view      → video_view                                               │
│  app_install     → app_install, mobile_app_install                          │
│                                                                              │
│  Выбор family определяется по optimization_goal AdSet:                      │
│  - LEAD_GENERATION → leadgen_form, website_lead                             │
│  - CONVERSATIONS → messages                                                 │
│  - LINK_CLICKS → click                                                      │
│  - VALUE → purchase, website_lead                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Структура аномалии

```typescript
interface Anomaly {
  anomaly_type: 'cpr_spike';           // Тип аномалии
  current_value: number;                // Текущий CPR
  baseline_value: number;               // Baseline CPR (медиана за N недель)
  delta_pct: number;                    // % отклонения
  anomaly_score: number;                // 0-1, severity
  confidence: number;                   // Уверенность (зависит от данных)
  likely_triggers: {                    // Возможные причины
    metric: string;                     // frequency, ctr, cpm, etc.
    value: number;
    delta: string;                      // "+30%", "-15%"
  }[];
  preceding_deviations: {               // Отклонения за 1-2 недели ДО
    week_0: WeekDeviations;             // Неделя аномалии
    week_minus_1: WeekDeviations;       // Неделя t-1
    week_minus_2: WeekDeviations;       // Неделя t-2
  };
}
```

---

## 5. Алгоритм детекции аномалий

### 5.1 Конфигурация

```typescript
const CONFIG = {
  cpr_spike_threshold: 1.20,    // 20% рост = аномалия
  ctr_drop_threshold: 0.80,     // 20% падение
  freq_high_threshold: 1.50,    // 50% выше baseline
  baseline_weeks: 4,            // Окно для baseline (снижено с 8)

  // Минимум результатов для анализа
  min_results_messages: 5,
  min_results_leads: 5,
  min_results_purchases: 3,
  min_results_clicks: 50,
}
```

### 5.2 Пороги значимости отклонений

| Метрика | Порог | Направление "bad" |
|---------|-------|-------------------|
| frequency | 15% | ↑ рост |
| ctr | 15% | ↓ падение |
| link_ctr | 15% | ↓ падение |
| cpm | 15% | ↑ рост |
| cpr | 20% | ↑ рост |
| spend | 30% | ↑ рост |
| results | 20% | ↓ падение |
| quality_ranking | 20% | ↓ падение |
| engagement_ranking | 20% | ↓ падение |
| conversion_ranking | 20% | ↓ падение |

### 5.3 Процесс детекции

```
1. Загрузка weekly data для объявления (все недели)
2. Для каждой недели с достаточными данными:
   a. Вычисление baseline (медиана за предыдущие N недель)
   b. Вычисление delta_pct = (current - baseline) / baseline * 100
   c. Если delta_pct > threshold → аномалия
   d. Анализ предшествующих отклонений (week-1, week-2)
   e. Определение likely_triggers
3. Сохранение аномалий в ad_weekly_anomalies
```

---

## 6. Burnout Predictions

### 6.1 Модель предсказания

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BURNOUT PREDICTION MODEL                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LEAD INDICATORS (неделя t):                                                │
│  ─────────────────────────                                                  │
│  • freq_delta_t        — изменение частоты                                  │
│  • ctr_delta_t         — изменение CTR                                      │
│  • cpc_delta_t         — изменение CPC                                      │
│  • reach_growth_t      — темп роста охвата                                  │
│  • spend_change_t      — изменение бюджета                                  │
│  • freq_slope_t        — тренд частоты за 4 недели                         │
│  • ctr_slope_t         — тренд CTR за 4 недели                             │
│                                                                              │
│                           │                                                  │
│                           ▼                                                  │
│                                                                              │
│  LAG TARGET (неделя t+1, t+2):                                              │
│  ────────────────────────────                                               │
│  • cpr_spike_t1        — был ли CPR spike через 1 неделю                   │
│  • cpr_spike_t2        — был ли CPR spike через 2 недели                   │
│  • cpr_delta_t1        — % изменения CPR через 1 неделю                    │
│  • cpr_delta_t2        — % изменения CPR через 2 недели                    │
│                                                                              │
│  CPR_SPIKE_THRESHOLD = 20%                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Risk Levels

| Level | Risk Score | Описание |
|-------|------------|----------|
| low | 0.00 - 0.25 | Низкий риск выгорания |
| medium | 0.25 - 0.50 | Средний риск, мониторинг |
| high | 0.50 - 0.75 | Высокий риск, рекомендуется action |
| critical | 0.75 - 1.00 | Критический, срочные меры |

---

## 7. Batch Job Tracking

### 7.1 Таблицы отслеживания

```sql
-- Основной job
CREATE TABLE batch_sync_jobs (
    id UUID PRIMARY KEY,
    job_type TEXT,              -- 'full_insights_sync'
    status TEXT,                -- pending, running, paused, completed, failed
    total_accounts INTEGER,
    processed_accounts INTEGER,
    failed_accounts INTEGER,
    skipped_accounts INTEGER,
    params JSONB,               -- конфигурация запуска
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- Детальный лог по аккаунтам
CREATE TABLE batch_sync_account_log (
    id UUID PRIMARY KEY,
    batch_job_id UUID,
    ad_account_id UUID,
    status TEXT,                -- pending, running, completed, failed, skipped
    step_fullsync TEXT,         -- pending, running, completed, failed, skipped
    step_features TEXT,
    step_anomalies TEXT,
    step_daily TEXT,
    step_burnout TEXT,
    result_summary JSONB,       -- {campaigns, adsets, ads, insights, anomalies, predictions}
    last_error TEXT,
    error_type TEXT,            -- token_invalid, rate_limited, network_error, data_error
    attempts INTEGER,
    duration_seconds INTEGER,
    worker_id INTEGER
);
```

### 7.2 Классификация ошибок

| Error Type | Описание | Retry |
|------------|----------|-------|
| token_invalid | Токен истёк или отозван | Нет |
| rate_limited | Превышен лимит API | Да (после паузы) |
| network_error | Сетевая ошибка | Да |
| data_error | Данные не найдены | Нет |
| unknown | Неизвестная ошибка | Да (до 3 попыток) |

---

## 8. Параметры запуска

### 8.1 CLI Options

```bash
npx tsx src/scripts/batchInsightsSync.ts [options]

Options:
  --workers <n>      Параллельных воркеров (default: 5)
  --limit <n>        Лимит аккаунтов
  --resume <id>      Продолжить существующий job
  --dry-run          Только план, без выполнения
  --pause-ms <ms>    Пауза между аккаунтами (default: 10000)
  --skip-fullsync    Пропустить fullSync
  --skip-daily       Пропустить daily enrichment
  --skip-burnout     Пропустить burnout predictions
  --verbose          Подробный вывод
```

### 8.2 Пример запуска

```bash
# Полный запуск на всех аккаунтах
npx tsx src/scripts/batchInsightsSync.ts --workers 5 --skip-daily

# Dry run для проверки
npx tsx src/scripts/batchInsightsSync.ts --dry-run

# Продолжить прерванный job
npx tsx src/scripts/batchInsightsSync.ts --resume 68397de6-45a1-410f-a20b-58d34b48f39f
```

---

## 9. Результаты запуска 25.12.2025

### 9.1 Общая статистика

| Метрика | Значение |
|---------|----------|
| Всего аккаунтов | 174 |
| Job ID | 68397de6-45a1-410f-a20b-58d34b48f39f |
| Status | completed |
| Время выполнения | ~55 минут |
| Workers | 5 |

### 9.2 Объём данных

| Таблица | Записей |
|---------|---------|
| ad_weekly_anomalies | 606 |
| ad_burnout_predictions | 589 |
| meta_insights_weekly | 1000+ |
| meta_weekly_results | 1000+ |
| ad_weekly_features | 1000+ |
| meta_ads | 1000+ |
| meta_adsets | 1000+ |
| meta_campaigns | 1000+ |

### 9.3 Типы аномалий
- **cpr_spike** — основной тип, рост CPR более 20%

### 9.4 Burnout Risk Distribution
- **high** — объявления с высоким риском выгорания
- **medium** — требуют мониторинга
- **low** — стабильные объявления

---

## 10. Технические детали

### 10.1 Facebook API Endpoints

```
GET /act_{account_id}/campaigns
GET /act_{account_id}/adsets
GET /act_{account_id}/ads
POST /act_{account_id}/insights (async)
GET /{report_run_id} (polling)
GET /{report_run_id}/insights (results)
```

### 10.2 Rate Limiting

- Группировка по business_id
- Пауза 10 секунд между аккаунтами
- 5 минут пауза при rate limit
- До 3 retry для network/rate errors

### 10.3 Важные файлы

| Файл | Описание |
|------|----------|
| `services/agent-service/src/scripts/batchInsightsSync.ts` | Основной скрипт batch sync |
| `services/agent-service/src/services/adInsightsSync.ts` | fullSync логика |
| `services/agent-service/src/services/resultNormalizer.ts` | Нормализация результатов |
| `services/agent-service/src/services/anomalyDetector.ts` | Детекция аномалий |
| `services/agent-service/src/services/burnoutAnalyzer.ts` | Burnout predictions |
| `services/agent-service/src/services/dailyBreakdownEnricher.ts` | Daily enrichment |
| `migrations/108_ad_insights_anomaly_pipeline.sql` | Основная схема БД |
| `migrations/124_batch_sync_jobs.sql` | Таблицы batch tracking |

---

## 11. Следующие шаги

### 11.1 Анализ паттернов аномалий
- [ ] Сезонность по месяцам/неделям
- [ ] Корреляция метрик с аномалиями
- [ ] Поведение за 1-2 недели до аномалии
- [ ] Общий дашборд паттернов

### 11.2 Улучшения модели
- [ ] ML-модель для предсказания
- [ ] Автоматические рекомендации
- [ ] Алерты в реальном времени

---

## Changelog

### v1.0 (25.12.2025)
- Initial batch sync implementation
- Support for multi-account and legacy accounts
- Baseline weeks reduced from 8 to 4
- Added normalization step to batch pipeline
- Full run on 174 accounts completed
