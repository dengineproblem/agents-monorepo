# Budget Forecast - Прогнозирование бюджета

## Обзор

Функциональность прогнозирования бюджета для пользователей. Показывает прогноз на 1-2 недели вперёд:
- **Baseline (no_change)**: что будет если ничего не менять
- **Scaling**: что будет при увеличении spend на +20%, +50%, +100%

## Архитектура

### Backend

```
services/agent-service/src/
├── services/
│   └── budgetForecaster.ts     # Логика прогнозирования
├── routes/
│   └── budgetForecast.ts       # User-facing endpoints
```

### Frontend

```
services/frontend/src/
├── types/
│   └── budgetForecast.ts       # TypeScript типы
├── services/
│   └── budgetForecastApi.ts    # API client
├── components/
│   └── budget-forecast/
│       ├── index.ts
│       ├── BudgetForecastTab.tsx
│       ├── ForecastSummaryCard.tsx
│       └── ForecastTable.tsx
```

## API Endpoints

### GET /budget-forecast/campaign/:campaignId

Прогноз для всех объявлений кампании.

**Query params:**
- `accountId` (optional) - UUID или act_xxx формат

**Headers:**
- `x-user-id` - ID пользователя (обязательно)

**Response:**
```typescript
{
  campaign_id: string;
  campaign_name: string;
  ads: AdForecast[];
  summary: CampaignForecastSummary;
  computed_at: string;
}
```

### GET /budget-forecast/ad/:adId

Прогноз для конкретного объявления.

## Модель прогнозирования

### Формулы

**Baseline (без изменений):**
```
cpr_predicted = median_cpr + cpr_slope * week_offset
spend_predicted = median_spend
results_predicted = spend_predicted / cpr_predicted
```

**Scaling (+delta%):**
```
spend_pred = current_spend * (1 + delta)
cpr_pred = current_cpr * exp(k * ln(1 + delta))
results_pred = spend_pred / cpr_pred
```

**Важно:** `cpr_slope` применяется ТОЛЬКО к baseline прогнозам. Для scaling прогнозов slope НЕ используется, т.к.:
- slope отражает исторический тренд CPR БЕЗ изменения бюджета
- при scaling эластичность k уже учитывает влияние бюджета на CPR
- применение slope к scaling давало бы нереалистичные результаты (CPR резко падал на week 2)

### Коэффициент эластичности k

Показывает как CPR реагирует на увеличение spend.

**Вычисление:**
```
k = sum(x*y) / sum(x^2)
где x = ln(spend_ratio), y = ln(cpr_ratio)
```

**Pooling (каскадный fallback):**
1. **Ad-level** (≥3 событий) - k для конкретного объявления
2. **Account+family** (≥10 событий) - k по аккаунту и типу результата
3. **Global+family** (≥30 событий) - глобальный k по типу результата
4. **Fallback** - 0.15 (эмпирическое значение)

### Событие роста spend

Неделя считается "событием роста" если:
```
spend_ratio = current_week_spend / prev_week_spend >= 1.15 (15% рост)
```

## Eligibility (требования к данным)

Для построения прогноза объявление должно иметь:
- Минимум **2 недели** истории данных
- Минимум **$10 spend** в неделю
- Минимум **3 результата** в неделю

## Известные проблемы

### 1. Несоответствие accountId и campaign

**Проблема:** Frontend передаёт `accountId` одного рекламного аккаунта, но кампания может принадлежать другому аккаунту в рамках мультиаккаунта.

**Текущее решение:** Fallback поиск - если кампания не найдена в указанном аккаунте, ищем её в любом аккаунте по `fb_campaign_id`.

**Правильное решение:** Frontend должен передавать правильный `accountId` для каждой кампании, или не передавать его вообще (тогда бэкенд найдёт автоматически).

### 2. Резолв accountId

**Структура данных:**
```
user_accounts.id (UUID) - ID пользователя
    ↓
ad_accounts.user_account_id (FK)
ad_accounts.id (UUID) - ID рекламного аккаунта (используется в meta_* таблицах)
ad_accounts.ad_account_id (string) - Facebook ID (act_xxx или числовой)
```

**Как работает резолв:**
1. Если передан UUID - используется напрямую
2. Если передан act_xxx - ищется в `ad_accounts.ad_account_id`
3. Если ничего не передано - ищется активный аккаунт пользователя

### 3. Кэширование

- Backend: In-memory cache, TTL 15 минут
- Frontend: localStorage cache, TTL 10 минут

## Структура таблиц

### meta_adsets
```sql
ad_account_id UUID  -- FK на ad_accounts.id
fb_campaign_id TEXT -- Facebook campaign ID
fb_adset_id TEXT    -- Facebook adset ID
```

### meta_ads
```sql
ad_account_id UUID  -- FK на ad_accounts.id
fb_adset_id TEXT    -- FK на meta_adsets.fb_adset_id
fb_ad_id TEXT       -- Facebook ad ID
name TEXT
```

### meta_weekly_results
```sql
ad_account_id UUID
fb_ad_id TEXT
week_start_date DATE
spend NUMERIC
cpr NUMERIC
result_count INTEGER
result_family TEXT  -- 'messages', 'leads', etc.
```

## UI

### CampaignDetail.tsx

Добавлены табы:
- **Обзор** - существующий контент (stats + adset list)
- **Прогноз** - BudgetForecastTab компонент

### BudgetForecastTab

1. **ForecastSummaryCard** - текущие метрики (Затраты/неделю, Результаты/неделю, Средний CPR, Подходящих объявлений)
2. **Сценарии масштабирования** - табы: Без изменений / +20% / +50% / +100%
3. **ScenarioCard** - прогноз на неделю +1 и +2 (Затраты, Результаты, CPR с процентами изменения)
4. **ForecastTable** - детализация по объявлениям:
   - Объявление, Тип
   - Затраты/нед, CPR (текущие)
   - CPR +20%, CPR +50%, CPR +100% (прогноз с цветовой индикацией: зелёный если ниже текущего, красный если выше)
   - Результаты (прогноз для выбранного сценария)
   - Модель (источник k: Ad/Account/Global/Fallback)
   - Статус (eligible или причина исключения)

## Дальнейшие улучшения

1. **Frontend:** Передавать правильный `accountId` из данных кампании
2. **Confidence intervals:** Добавить доверительные интервалы в прогнозы
3. **Визуализация:** Графики трендов CPR и spend
4. **Алерты:** Предупреждения при неблагоприятном прогнозе
