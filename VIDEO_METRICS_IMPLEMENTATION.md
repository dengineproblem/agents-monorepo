# 🎥 Video Metrics Implementation

**Дата:** 20 ноября 2025  
**Статус:** ✅ Готово к деплою

---

## 📋 Что сделано

### 1. Миграция БД (`031_add_video_metrics_to_history.sql`)

Добавлены 6 колонок в `creative_metrics_history`:

```sql
ALTER TABLE creative_metrics_history
ADD COLUMN video_views INTEGER DEFAULT 0,
ADD COLUMN video_views_25_percent INTEGER DEFAULT 0,
ADD COLUMN video_views_50_percent INTEGER DEFAULT 0,
ADD COLUMN video_views_75_percent INTEGER DEFAULT 0,
ADD COLUMN video_views_95_percent INTEGER DEFAULT 0,
ADD COLUMN video_avg_watch_time_sec NUMERIC(10,2);
```

**Индекс для быстрого поиска:**
```sql
CREATE INDEX idx_creative_metrics_history_video_engagement 
ON creative_metrics_history(user_account_id, creative_id, date DESC) 
WHERE video_views > 0;
```

---

### 2. Agent-Brain (`scoring.js`)

#### Обновлен `fetchAdInsights()`
Добавлены video-поля в запрос к Facebook API:

```javascript
fields: 'impressions,reach,spend,clicks,actions,ctr,cpm,frequency,
         video_play_actions,video_avg_time_watched_actions,
         video_p25_watched_actions,video_p50_watched_actions,
         video_p75_watched_actions,video_p95_watched_actions'
```

#### Новая функция `extractVideoMetrics()`
Извлекает video-метрики из FB API response:

```javascript
function extractVideoMetrics(insights) {
  return {
    video_views: parseInt(insights.video_play_actions?.[0]?.value) || 0,
    video_views_25_percent: parseInt(insights.video_p25_watched_actions?.[0]?.value) || 0,
    video_views_50_percent: parseInt(insights.video_p50_watched_actions?.[0]?.value) || 0,
    video_views_75_percent: parseInt(insights.video_p75_watched_actions?.[0]?.value) || 0,
    video_views_95_percent: parseInt(insights.video_p95_watched_actions?.[0]?.value) || 0,
    video_avg_watch_time_sec: parseFloat(insights.video_avg_time_watched_actions?.[0]?.value) || null
  };
}
```

#### Обновлен `saveCreativeMetricsToHistory()`
Сохраняет video-метрики в БД:

```javascript
records.push({
  user_account_id,
  date: today,
  ad_id, creative_id, adset_id, campaign_id,
  impressions, reach, spend, clicks, leads, cpl,
  // Video metrics
  video_views: videoMetrics.video_views,
  video_views_25_percent: videoMetrics.video_views_25_percent,
  video_views_50_percent: videoMetrics.video_views_50_percent,
  video_views_75_percent: videoMetrics.video_views_75_percent,
  video_views_95_percent: videoMetrics.video_views_95_percent,
  video_avg_watch_time_sec: videoMetrics.video_avg_watch_time_sec,
  source: 'production'
});
```

---

### 3. Creative Analyzer (`analyzerService.js`)

Обновлена запись test метрик в `creative_metrics_history`:

```javascript
await supabase.from('creative_metrics_history').upsert({
  user_account_id, date, ad_id, creative_id,
  impressions, reach, spend, clicks, leads, cpl,
  // Video metrics из теста
  video_views: test.video_views || 0,
  video_views_25_percent: test.video_views_25_percent || 0,
  video_views_50_percent: test.video_views_50_percent || 0,
  video_views_75_percent: test.video_views_75_percent || 0,
  video_views_95_percent: test.video_views_95_percent || 0,
  video_avg_watch_time_sec: test.video_avg_watch_time_sec || null,
  source: 'test'  // Помечаем как тестовые
});
```

---

### 4. Документация

Обновлен `METRICS_SYSTEM.md`:
- Добавлен раздел **"🎥 Видео-метрики (Video Engagement)"**
- Примеры SQL запросов для анализа engagement rate
- Объяснение как используются метрики в LLM
- Маппинг Facebook API fields → наши колонки

---

## 🎯 Преимущества

### Для Agent-Brain
✅ Собирает видео-метрики один раз утром  
✅ Хранит полную историю engagement по дням  
✅ Может анализировать тренды просмотра

### Для Creative Analyzer
✅ Сохраняет video engagement из тестов  
✅ Можно сравнивать test vs production engagement  
✅ LLM получает данные о качестве просмотра

### Для Auto-Launch (будущее)
✅ Может выбирать креативы с высоким engagement  
✅ Быстрый доступ к video-метрикам из БД  
✅ Не нужно делать дополнительные запросы к FB API

---

## 📊 Пример использования

### SQL: Топ креативов по engagement

```sql
SELECT 
  creative_id,
  SUM(video_views) as total_views,
  ROUND(
    (SUM(video_views_50_percent)::NUMERIC / NULLIF(SUM(video_views), 0)) * 100, 
    2
  ) as engagement_50_pct,
  ROUND(AVG(video_avg_watch_time_sec), 2) as avg_watch_time
FROM creative_metrics_history
WHERE user_account_id = 'YOUR_ID'
  AND date >= CURRENT_DATE - INTERVAL '30 days'
  AND video_views > 0
GROUP BY creative_id
ORDER BY engagement_50_pct DESC
LIMIT 10;
```

### SQL: Сравнение test vs production

```sql
SELECT 
  source,
  COUNT(*) as records,
  AVG(video_views_50_percent::NUMERIC / NULLIF(video_views, 0) * 100) as avg_engagement_50,
  AVG(video_avg_watch_time_sec) as avg_watch_time
FROM creative_metrics_history
WHERE creative_id = 'YOUR_CREATIVE_ID'
  AND video_views > 0
GROUP BY source;
```

**Ожидаемый результат:**
```
source     | records | avg_engagement_50 | avg_watch_time
-----------|---------|-------------------|---------------
test       | 1       | 65.5             | 8.3
production | 30      | 48.2             | 6.1
```

---

## 🚀 Deployment

### 1. Запустить миграцию

```bash
# На production сервере
cd ~/agents-monorepo
docker exec -i agents-monorepo-postgres-1 psql -U postgres -d agents < migrations/031_add_video_metrics_to_history.sql
```

### 2. Пересобрать и перезапустить agent-brain

```bash
docker-compose build agent-brain creative-analyzer
docker-compose up -d agent-brain creative-analyzer
```

### 3. Проверить что метрики собираются

```bash
# Запустить test scoring для пользователя
curl -X POST http://localhost:7080/api/brain/test-scoring \
  -H "Content-Type: application/json" \
  -d '{"userAccountId": "USER_ID"}'

# Проверить что видео-метрики сохранились
docker exec -it agents-monorepo-postgres-1 psql -U postgres -d agents -c "
SELECT 
  creative_id,
  video_views,
  video_views_50_percent,
  video_avg_watch_time_sec
FROM creative_metrics_history
WHERE user_account_id = 'USER_ID'
  AND video_views > 0
LIMIT 5;
"
```

---

## ✅ Checklist

- [x] Миграция создана (`031_add_video_metrics_to_history.sql`)
- [x] `scoring.js` обновлен (fetchAdInsights, extractVideoMetrics, saveCreativeMetricsToHistory)
- [x] `analyzerService.js` обновлен (сохранение test video-метрик)
- [x] Документация обновлена (`METRICS_SYSTEM.md`)
- [x] Код проверен (no linter errors)
- [ ] Миграция применена на production
- [ ] Сервисы перезапущены
- [ ] Проверка сбора метрик

---

## 🔍 Важные детали

### Для видео vs картинок

- **Видео-креативы:** Все video поля будут заполнены (если есть просмотры)
- **Картинки:** video_views = 0, остальные NULL или 0

### Обработка NULL

```javascript
// Правильно обрабатывать NULL из FB API
video_avg_watch_time_sec: parseFloat(insights.video_avg_time_watched_actions?.[0]?.value) || null
```

### Source разделение

- `source: 'production'` — agent-brain (утренний сбор)
- `source: 'test'` — creative-analyzer (быстрые тесты)

Это позволяет отличать краткосрочные test метрики от долгосрочных production.

---

**Готово к деплою!** 🚀

