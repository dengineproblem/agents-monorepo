# 📊 Unified Metrics System - Система унифицированных метрик

**Дата создания:** 20 ноября 2025  
**Статус:** ✅ Активна  
**Версия:** 1.0

---

## 🎯 Цель системы

Унифицированная система метрик решает проблему дублирования запросов к Facebook API:
- **agent-brain** собирает метрики утром один раз
- **auto-launch**, **scoring**, **creative tests** читают из БД (быстро, без FB API)
- Единая таблица `creative_metrics_history` для всех систем

---

## 🏗️ Архитектура

### Поток данных

```
┌─────────────────┐
│   Facebook API  │ ← Источник данных
└────────┬────────┘
         │
         ├─── Утром (cron 9:00)
         │    ┌──────────────────┐
         │    │  agent-brain     │
         │    │  (scoring.js)    │
         │    └────────┬─────────┘
         │             │ fetchAdInsights()
         │             │ saveCreativeMetricsToHistory()
         │             ↓
         │    ┌──────────────────────────┐
         │    │ creative_metrics_history │ ← Единая таблица
         │    └────────┬─────────────────┘
         │             │
         ├─────────────┼─────────────────────┐
         │             │                     │
         ↓             ↓                     ↓
┌──────────────┐ ┌─────────────┐ ┌──────────────────┐
│ auto-launch  │ │  scoring    │ │  creative tests  │
│ (fast, DB)   │ │  (fast, DB) │ │  (fast, DB)      │
└──────────────┘ └─────────────┘ └──────────────────┘

FALLBACK: Если данных в БД нет (новый креатив) → FB API
```

### Уровень данных

**НОВОЕ:** Метрики хранятся на уровне **Ad** (не AdSet!)

```
Campaign (fb_campaign_id)
  └── AdSet (adset_id)
       └── Ad (ad_id) ← МЕТРИКИ ЗДЕСЬ
            └── Creative (fb_creative_id)
```

**Связь через `ad_creative_mapping`:**
```sql
ad_creative_mapping
  - ad_id (Facebook Ad ID)
  - creative_id (fb_creative_id)
  - user_creative_id (наш UUID)
  - direction_id (направление бизнеса)
```

---

## 📋 Таблица: creative_metrics_history

### Структура (после миграции 030)

```sql
CREATE TABLE creative_metrics_history (
  id UUID PRIMARY KEY,
  user_account_id UUID,
  date DATE,
  
  -- НОВОЕ: Точный мэтчинг через ad_creative_mapping
  ad_id TEXT,              -- Facebook Ad ID
  creative_id TEXT,        -- fb_creative_id (теперь заполняется!)
  
  -- Для обратной совместимости
  adset_id TEXT,
  campaign_id TEXT,
  
  -- Основные метрики
  impressions INTEGER,
  reach INTEGER,
  spend DECIMAL(10,2),
  
  -- НОВОЕ: Расширенные метрики
  clicks INTEGER,          -- Общие клики
  link_clicks INTEGER,     -- Клики по ссылке
  leads INTEGER,           -- Лиды
  cpl DECIMAL(10,2),       -- Cost per lead (вычисляемое)
  
  -- Показатели эффективности
  ctr DECIMAL(5,2),        -- Click-through rate (%)
  cpm DECIMAL(10,2),       -- Cost per 1000 impressions
  frequency DECIMAL(5,2),  -- Частота показа
  
  -- Facebook Diagnostics
  quality_ranking TEXT,
  engagement_rate_ranking TEXT,
  conversion_rate_ranking TEXT,
  
  created_at TIMESTAMPTZ
);

-- Индексы
CREATE INDEX idx_creative_metrics_ad_id ON creative_metrics_history(ad_id);
CREATE UNIQUE INDEX creative_metrics_ad_date_unique 
  ON creative_metrics_history(user_account_id, ad_id, date);
```

### Ключевые особенности

1. **Уникальность:** Одна запись = 1 Ad + 1 день
2. **Агрегация:** Если у креатива несколько ads → суммируем при чтении
3. **Обратная совместимость:** Старые записи (adset_id без ad_id) сохраняются

---

## 🔄 Процесс сбора метрик

### 1. Agent-Brain (утренний cron)

**Файл:** `services/agent-brain/src/scoring.js`

**Функция:** `saveCreativeMetricsToHistory()`

**Алгоритм:**
```javascript
for (каждый креатив в readyCreatives) {
  // 1. Найти все ads через ad_creative_mapping
  const mappings = await supabase
    .from('ad_creative_mapping')
    .select('ad_id, adset_id, campaign_id, fb_creative_id')
    .eq('user_creative_id', creative.user_creative_id);
  
  for (каждый ad в mappings) {
    // 2. Получить метрики из FB API
    const insights = await fetchAdInsights(ad_id, 'last_7d');
    
    // 3. Извлечь лиды и клики
    const leads = extractLeads(insights.actions);
    const linkClicks = extractLinkClicks(insights.actions);
    
    // 4. Вычислить CPL
    const cpl = leads > 0 ? (spend * 100 / leads) : null;
    
    // 5. Сохранить в БД
    await supabase.from('creative_metrics_history').upsert({
      user_account_id,
      date: today,
      ad_id: ad.ad_id,
      creative_id: ad.fb_creative_id,
      impressions, clicks, leads, cpl, ...
    });
  }
}
```

**Когда запускается:** Каждое утро в 9:00 (UTC+6) через cron

**Логирование:**
```
[scoring_agent] phase=saving_metrics_to_history
[saveCreativeMetricsToHistory] saved_count=45
```

---

### 2. Creative Test Analyzer

**Файл:** `services/agent-brain/src/analyzerService.js`

**Endpoint:** 
- `POST /api/analyzer/analyze-test` - анализ быстрого теста
- `GET /api/analyzer/creative-analytics/:user_creative_id` - полная аналитика

**Что делает:**
- **НЕ ПИШЕТ** в `creative_metrics_history` (избегаем конфликтов!)
- **ЧИТАЕТ** из двух источников:
  - `creative_tests` - для тестовых метрик
  - `creative_metrics_history` - для production метрик (с fallback на FB API)

**Важно:** 
- Тестовые метрики остаются **ТОЛЬКО** в `creative_tests`
- Production метрики в `creative_metrics_history` управляются **ТОЛЬКО** agent-brain
- Это предотвращает перезапись долгосрочных метрик краткосрочными тестовыми

---

## 🔀 Разделение: Тесты vs Production

### Проблема: Конфликт метрик

**Сценарий конфликта:**
1. Креатив работает в production (ad_id = "123")
2. agent-brain сохраняет метрики → `creative_metrics_history` (долгосрочные)
3. Запускаем быстрый тест этого креатива
4. Тест завершается с небольшими метриками
5. ❌ КОНФЛИКТ: Тестовые метрики могут перезаписать production!

### ✅ Решение: Раздельные таблицы

```
┌─────────────────────────────────────────┐
│     creative_metrics_history            │
│  ✅ Production метрики (долгосрочные)   │
│  ✅ Заполняет: ТОЛЬКО agent-brain       │
│  ✅ Читают: auto-launch, scoring,       │
│              creative-analyzer          │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│        creative_tests                   │
│  ✅ Тестовые метрики (краткосрочные)    │
│  ✅ Заполняет: creative-analyzer        │
│  ✅ Читают: creative-analyzer           │
└─────────────────────────────────────────┘
```

### Правила работы

| Система | Читает откуда | Пишет куда |
|---------|--------------|-----------|
| **agent-brain** | FB API | `creative_metrics_history` |
| **auto-launch** | `creative_metrics_history` → FB API | нигде |
| **creative-analyzer (тест)** | `creative_tests` | `creative_tests` |
| **creative-analyzer (production)** | `creative_metrics_history` → FB API | нигде |

### Lifecycle креатива

```
1. Создание креатива
   └── Статус: draft

2. Быстрый тест (опционально)
   └── creative_tests.status = 'running'
   └── Накопление метрик (1000 impressions)
   └── creative_tests.status = 'completed'
   └── LLM анализ сохраняется в creative_tests

3. Запуск в production
   └── Создается campaign/adset/ad
   └── ad_creative_mapping связывает ad с креативом

4. Утренний сбор метрик
   └── agent-brain → creative_metrics_history
   └── Долгосрочная история (7-30 дней)

5. Auto-launch использует метрики
   └── Читает creative_metrics_history (быстро)
   └── Видит production данные, НЕ тестовые
```

### Пример: Один креатив, две истории

```sql
-- ТЕСТ (краткосрочный, 1000 impressions)
SELECT * FROM creative_tests 
WHERE user_creative_id = 'abc-123'
  AND status = 'completed';
/*
impressions: 1000
leads: 5
cpl_cents: 400
llm_score: 75
*/

-- PRODUCTION (долгосрочный, 50000 impressions)
SELECT 
  SUM(impressions) as total_impressions,
  SUM(leads) as total_leads,
  ROUND(SUM(spend) / SUM(leads), 2) as cpl
FROM creative_metrics_history
WHERE creative_id = (
  SELECT fb_creative_id_whatsapp 
  FROM user_creatives 
  WHERE id = 'abc-123'
)
AND date >= CURRENT_DATE - INTERVAL '30 days';
/*
total_impressions: 50000
total_leads: 300
cpl: 2.50
*/
```

**Разные метрики, разные выводы:**
- Тест показал CPL $4.00 на малой выборке
- Production показал CPL $2.50 на большой выборке
- Тест помог принять решение о запуске
- Production показал реальную эффективность

---

## 📖 Использование системы

### Auto-Launch (Campaign Builder)

**Файл:** `services/agent-service/src/lib/campaignBuilder.ts`

**Функция:** `getCreativeMetrics()`

**Алгоритм:**
```typescript
// 1. Пытаемся получить за сегодня
let metrics = await supabase
  .from('creative_metrics_history')
  .select('*')
  .eq('date', today);

// 2. Если нет - за вчера
if (!metrics.length) {
  metrics = await supabase...eq('date', yesterday);
}

// 3. Агрегируем по creative_id (если несколько ads)
for (const metric of metrics) {
  aggregated[creative_id].impressions += metric.impressions;
  aggregated[creative_id].leads += metric.leads;
  aggregated[creative_id].spend += metric.spend;
}

// 4. Вычисляем средние CTR, CPM, CPL
const ctr = (clicks / impressions) * 100;
const cpm = (spend / impressions) * 1000;
const cpl = leads > 0 ? spend / leads : null;
```

**Fallback на FB API:**
```typescript
const missingCreativeIds = creativeIds.filter(id => !metricsMap.has(id));

if (missingCreativeIds.length > 0) {
  log.info({ count: missingCreativeIds.length }, 'Fetching missing metrics from FB API');
  // Параллельные запросы к FB API
}
```

**Логирование:**
```
[getAvailableCreatives] fromDB=15 fromAPI=2 total=17
```

---

## 🔍 SQL запросы

### Получить метрики креатива за последние 30 дней

```sql
SELECT 
  creative_id,
  date,
  COUNT(*) as ads_count,
  SUM(impressions) as total_impressions,
  SUM(clicks) as total_clicks,
  SUM(leads) as total_leads,
  SUM(spend) as total_spend,
  ROUND((SUM(clicks)::DECIMAL / NULLIF(SUM(impressions), 0) * 100)::NUMERIC, 2) as ctr,
  ROUND((SUM(spend)::DECIMAL / NULLIF(SUM(impressions), 0) * 1000)::NUMERIC, 2) as cpm,
  ROUND((SUM(spend)::DECIMAL / NULLIF(SUM(leads), 0))::NUMERIC, 2) as cpl
FROM creative_metrics_history
WHERE creative_id = 'YOUR_CREATIVE_ID'
  AND date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY creative_id, date
ORDER BY date DESC;
```

### Найти креативы БЕЗ метрик (нужен fallback)

```sql
SELECT 
  uc.id,
  uc.title,
  uc.fb_creative_id_whatsapp
FROM user_creatives uc
LEFT JOIN creative_metrics_history cm 
  ON uc.fb_creative_id_whatsapp = cm.creative_id
  AND cm.date >= CURRENT_DATE - INTERVAL '2 days'
WHERE uc.user_id = 'YOUR_USER_ID'
  AND uc.status = 'ready'
  AND cm.id IS NULL;
```

### Проверить связь с ad_creative_mapping

```sql
SELECT 
  cm.ad_id,
  cm.creative_id,
  cm.impressions,
  cm.leads,
  acm.user_creative_id,
  acm.direction_id
FROM creative_metrics_history cm
INNER JOIN ad_creative_mapping acm ON cm.ad_id = acm.ad_id
WHERE cm.date = CURRENT_DATE;
```

---

## 🚨 Troubleshooting

### Проблема: Метрики не сохраняются

**Проверка:**
```sql
SELECT COUNT(*), MAX(date) as last_date
FROM creative_metrics_history
WHERE user_account_id = 'YOUR_ID';
```

**Возможные причины:**
1. agent-brain не запустился (проверить cron логи)
2. Нет ads в ad_creative_mapping (креативы не запущены)
3. FB API недоступен (проверить логи: "Failed to fetch ad insights")

**Решение:**
```bash
# Проверить логи agent-brain
docker logs agents-monorepo-agent-brain-1 --tail 100 | grep saveCreativeMetricsToHistory

# Вручную запустить scoring agent
curl -X POST http://localhost:7080/api/scoring/run
```

---

### Проблема: Auto-launch медленный (все запросы в FB API)

**Проверка:**
```bash
# Смотрим логи auto-launch
docker logs agents-monorepo-agent-service-1 | grep "fromDB"
```

**Ожидаемый результат:**
```
[getAvailableCreatives] fromDB=20 fromAPI=0 total=20
```

**Если fromAPI > 0:**
- Метрики в БД устарели (> 2 дней)
- Новые креативы (еще не обработаны agent-brain)
- agent-brain не отработал сегодня

---

### Проблема: Дублирование метрик

**Проверка:**
```sql
SELECT ad_id, date, COUNT(*)
FROM creative_metrics_history
GROUP BY ad_id, date
HAVING COUNT(*) > 1;
```

**Не должно быть дубликатов** (UNIQUE constraint на `user_account_id, ad_id, date`)

---

## 📈 Мониторинг

### Метрики для отслеживания

1. **Coverage (покрытие):** Сколько % креативов имеют метрики в БД
```sql
SELECT 
  COUNT(DISTINCT uc.id) as total_creatives,
  COUNT(DISTINCT cm.creative_id) as creatives_with_metrics,
  ROUND(COUNT(DISTINCT cm.creative_id)::DECIMAL / COUNT(DISTINCT uc.id) * 100, 2) as coverage_pct
FROM user_creatives uc
LEFT JOIN creative_metrics_history cm 
  ON uc.fb_creative_id_whatsapp = cm.creative_id
  AND cm.date >= CURRENT_DATE - INTERVAL '2 days'
WHERE uc.status = 'ready';
```

2. **Freshness (свежесть):** Сколько дней назад последнее обновление
```sql
SELECT 
  user_account_id,
  MAX(date) as last_update,
  CURRENT_DATE - MAX(date) as days_ago
FROM creative_metrics_history
GROUP BY user_account_id;
```

3. **Fallback rate (частота fallback на FB API):**
```bash
# Из логов auto-launch
grep "fromAPI" agent-service.log | awk '{print $NF}' | sort | uniq -c
```

---

## 🔧 Обслуживание

### Очистка старых данных (> 90 дней)

```sql
DELETE FROM creative_metrics_history
WHERE date < CURRENT_DATE - INTERVAL '90 days';
```

### Пересчет метрик для конкретного креатива

```bash
# Вручную запустить agent-brain для конкретного пользователя
curl -X POST http://localhost:7080/api/scoring/run \
  -H "Content-Type: application/json" \
  -d '{"user_account_id": "YOUR_ID"}'
```

---

## 📊 Преимущества системы

| До | После |
|----|-------|
| ❌ auto-launch делает 20 запросов к FB API | ✅ auto-launch читает из БД (0 запросов) |
| ❌ Каждый сервис дублирует логику | ✅ Единая логика в agent-brain |
| ❌ Slow (5-10 секунд для 20 креативов) | ✅ Fast (< 1 секунда) |
| ❌ Рискует упереться в rate limits | ✅ Безопасно (1 раз утром) |
| ❌ Разные источники правды | ✅ Единый источник правды |

---

## 🎓 Best Practices

1. **Всегда проверяй freshness:** Метрики старше 2 дней → fallback на FB API
2. **Агрегируй по creative_id:** У креатива может быть несколько ads
3. **Логируй fallback:** Важно знать когда идет запрос к FB API
4. **Используй UNIQUE constraints:** Предотвращает дубликаты
5. **Конвертируй единицы:** БД хранит доллары, не центы

---

## 📚 Связанные документы

- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) - Общая инфраструктура проекта
- [migrations/030_expand_creative_metrics_history.sql](./migrations/030_expand_creative_metrics_history.sql) - Миграция БД
- [TEST_UNIFIED_METRICS.sql](./TEST_UNIFIED_METRICS.sql) - SQL запросы для тестирования

---

**Дата последнего обновления:** 20 ноября 2025  
**Автор:** AI Assistant  
**Статус:** ✅ Production Ready

