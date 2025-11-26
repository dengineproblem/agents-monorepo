# Инструкции по тестированию системы сбора метрик креативов

## Обзор изменений

Реализована система ежедневного сбора метрик креативов с агрегацией через `ad_creative_mapping`:

### Созданные файлы:
1. ✅ `migrations/036_add_source_to_metrics_history.sql` - добавление поля source
2. ✅ `migrations/037_creative_metrics_aggregation_function.sql` - SQL функция для агрегации

### Измененные файлы:
1. ✅ `services/agent-brain/src/scoring.js`:
   - Обновлен `fetchAdInsights()` для поддержки time_range
   - Раскомментирован и переписан `saveCreativeMetricsToHistory()`
   - Добавлен вызов в `runScoringAgent()`
   
2. ✅ `services/frontend/src/services/salesApi.ts`:
   - Обновлен `getCreativeMetrics()` для агрегации через ad_creative_mapping
   - Добавлена функция `aggregateMetricsByDate()`

---

## 1️⃣ Применение миграций БД

**ВАЖНО:** Сначала примените миграции к базе данных:

```bash
# Подключитесь к Supabase (или вашей PostgreSQL)
# Выполните миграции в порядке:

# 1. Миграция 036 - добавление поля source
psql -h YOUR_DB_HOST -U YOUR_DB_USER -d YOUR_DB_NAME -f migrations/036_add_source_to_metrics_history.sql

# 2. Миграция 037 - SQL функция для агрегации
psql -h YOUR_DB_HOST -U YOUR_DB_USER -d YOUR_DB_NAME -f migrations/037_creative_metrics_aggregation_function.sql
```

**Проверка:**
```sql
-- Проверить что поле source добавлено
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'creative_metrics_history' AND column_name = 'source';

-- Проверить что функция создана
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name = 'get_creative_aggregated_metrics';
```

---

## 2️⃣ Тестирование Backend: Сбор метрик

### Шаг 1: Перезапустите agent-brain сервис

```bash
# Остановить и запустить заново для применения изменений
docker-compose restart agent-brain

# Или
cd services/agent-brain
npm run dev
```

### Шаг 2: Ручной запуск scoring agent

```bash
# Замените YOUR_USER_ID на реальный UUID пользователя
curl -X POST http://localhost:7080/api/brain/run \
  -H "Content-Type: application/json" \
  -d '{"userAccountId": "YOUR_USER_ID", "inputs": {"dispatch": false}}'
```

**Ожидаемый результат в логах:**

```
[scoring_agent] phase=saving_metrics_to_history, creatives_count=5
[saveCreativeMetricsToHistory] Starting to save creative metrics to history, date=2025-11-20
[saveCreativeMetricsToHistory] Found ad mappings, creative_id=..., ads_count=3
[saveCreativeMetricsToHistory] Collected metrics for ad, ad_id=123, impressions=1200, leads=7
[saveCreativeMetricsToHistory] No impressions, skipping, ad_id=456
[saveCreativeMetricsToHistory] Successfully saved creative metrics to history, saved_count=8, date=2025-11-20
[scoring_agent] phase=metrics_saved
```

**Если метрик нет:**
```
[saveCreativeMetricsToHistory] No metrics to save (no ads with impressions yesterday)
```

Это нормально если вчера не было показов.

### Шаг 3: Проверка логов

```bash
# Посмотреть последние логи
docker logs agents-monorepo-agent-brain-1 --tail 200 | grep saveCreativeMetricsToHistory

# Или если запущено локально
tail -f logs/agent-brain.log | grep saveCreativeMetricsToHistory
```

---

## 3️⃣ Проверка данных в БД

### Проверка 1: Данные сохранились

```sql
-- Проверить что метрики за вчерашний день сохранились
SELECT 
  date,
  ad_id,
  creative_id,
  impressions,
  leads,
  spend,
  source
FROM creative_metrics_history
WHERE user_account_id = 'YOUR_USER_ID'
  AND date = CURRENT_DATE - INTERVAL '1 day'
  AND source = 'production'
ORDER BY ad_id;
```

**Ожидаемый результат:**
- Несколько строк (по одной на каждый ad с показами)
- `date` = вчерашний день
- `source` = 'production'
- `impressions` > 0

### Проверка 2: Агрегация через ad_creative_mapping

```sql
-- Получить агрегированные метрики креатива
SELECT 
  uc.id as creative_id,
  uc.title,
  COUNT(DISTINCT cmh.ad_id) as ads_count,
  SUM(cmh.impressions) as total_impressions,
  SUM(cmh.clicks) as total_clicks,
  SUM(cmh.leads) as total_leads,
  SUM(cmh.spend) as total_spend
FROM user_creatives uc
INNER JOIN ad_creative_mapping acm ON uc.id = acm.user_creative_id
INNER JOIN creative_metrics_history cmh ON acm.ad_id = cmh.ad_id
WHERE uc.user_id = 'YOUR_USER_ID'
  AND cmh.source = 'production'
  AND cmh.date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY uc.id, uc.title;
```

**Ожидаемый результат:**
- Для каждого креатива агрегированные метрики всех его ads
- Если креатив используется в 3 ads, `ads_count` = 3
- Суммы метрик корректны

### Проверка 3: SQL функция для агрегации

```sql
-- Протестировать SQL функцию (замените UUID)
SELECT * FROM get_creative_aggregated_metrics(
  'user-creative-uuid'::UUID,  -- UUID креатива
  'user-account-uuid'::UUID,   -- UUID аккаунта
  30                           -- дней
);
```

**Ожидаемый результат:**
- Строки сгруппированы по дням
- Метрики агрегированы (сумма impressions, средний CTR и т.д.)

---

## 4️⃣ Тестирование Frontend: ROI Analytics

### Шаг 1: Перезапустите frontend

```bash
cd services/frontend
npm run dev
```

### Шаг 2: Откройте ROI аналитику

1. Перейдите на страницу ROI аналитики
2. Убедитесь, что в списке есть креативы с данными
3. Нажмите "Показать детали" для креатива

### Шаг 3: Проверьте отображение

**Ожидаемый результат:**
- Таблица метрик должна показывать данные по дням
- Колонки: Date, Impressions, Reach, Clicks, CTR, Leads, Spend, CPM, CPL
- Видео-метрики (если есть): 25%, 50%, 75% досмотров

**Проверка агрегации:**
- Если креатив в нескольких ads, метрики суммируются
- Например: ad1 (1000 impressions) + ad2 (800 impressions) = 1800 total

### Шаг 4: Проверка в консоли браузера

Откройте DevTools → Network → найдите запрос к Supabase:

**Запрос должен идти так:**
1. Запрос к `ad_creative_mapping` (получить ad_id)
2. Запрос к `creative_metrics_history` с фильтром `in(ad_id, [...])` и `source = 'production'`
3. Агрегация на клиенте (группировка по дням)

---

## 5️⃣ Проверка работы CRON

### Шаг 1: Проверка расписания

```bash
# Посмотреть логи при запуске cron (в 8:00)
docker logs agents-monorepo-agent-brain-1 --since 8h | grep cron

# Ожидаемый лог:
# [cron] schedule=0 8 * * *, status=triggered
# [processDailyBatch] status=started
# [processUser] userId=..., status=started
# [scoring_agent] phase=saving_metrics_to_history
```

### Шаг 2: Ручной запуск batch

```bash
# Запустить batch обработку вручную
curl -X POST http://localhost:7080/api/batch/run
```

**Ожидаемый результат:**
- Обработка всех активных пользователей
- Для каждого вызывается `runScoringAgent()`
- Метрики сохраняются за вчерашний день

---

## 6️⃣ Проверка edge cases

### Case 1: Креатив без показов вчера

**Ожидание:** Строка в БД НЕ создается (пропускается)

```sql
-- Не должно быть строк с impressions = 0
SELECT COUNT(*) 
FROM creative_metrics_history 
WHERE impressions = 0 AND source = 'production';
-- Результат: 0
```

### Case 2: Креатив в нескольких ads

**Ожидание:** Создается несколько строк (по одной на ad), frontend агрегирует

```sql
-- Пример: креатив в 3 ads
SELECT ad_id, impressions 
FROM creative_metrics_history 
WHERE creative_id = 'fb_12345' 
  AND date = CURRENT_DATE - INTERVAL '1 day';

-- Результат:
-- ad1 | 1000
-- ad2 | 800  
-- ad3 | 500
-- Total (на frontend): 2300
```

### Case 3: Повторный запуск в тот же день

**Ожидание:** Данные обновляются (upsert с ignoreDuplicates=false)

```bash
# Запустить scoring agent дважды
curl -X POST http://localhost:7080/api/brain/run -d '{"userAccountId": "..."}'
curl -X POST http://localhost:7080/api/brain/run -d '{"userAccountId": "..."}'

# Проверить что нет дубликатов
SELECT ad_id, date, COUNT(*) 
FROM creative_metrics_history 
WHERE date = CURRENT_DATE - INTERVAL '1 day'
GROUP BY ad_id, date 
HAVING COUNT(*) > 1;
-- Результат: 0 строк (нет дубликатов)
```

---

## 7️⃣ Troubleshooting

### Проблема: Метрики не сохраняются

**Проверка 1:** Есть ли ads в ad_creative_mapping?
```sql
SELECT COUNT(*) FROM ad_creative_mapping 
WHERE user_creative_id IN (
  SELECT id FROM user_creatives WHERE user_id = 'YOUR_USER_ID'
);
```

**Проверка 2:** Были ли показы вчера?
- Проверьте в Facebook Ads Manager
- Возможно ads были неактивны вчера

**Проверка 3:** Логи agent-brain
```bash
docker logs agents-monorepo-agent-brain-1 --tail 500 | grep -A 10 saveCreativeMetricsToHistory
```

### Проблема: Frontend показывает пустую таблицу

**Проверка 1:** Есть ли данные в БД?
```sql
SELECT COUNT(*) FROM creative_metrics_history 
WHERE user_account_id = 'YOUR_USER_ID' AND source = 'production';
```

**Проверка 2:** Правильно ли передается creative_id?
- В ROI аналитике используется `campaign.id` как creative_id
- Проверьте что это user_creative_id (UUID), а не fb_creative_id

**Проверка 3:** Консоль браузера
- Откройте DevTools → Console
- Ищите ошибки при загрузке метрик
- Проверьте Network запросы

### Проблема: Метрики за вчера неполные

**Причина:** Facebook API delay (24-48 часов для финальных данных)

**Решение:** Это нормально. Данные могут досчитываться Facebook в течение 1-2 дней.

---

## 8️⃣ Мониторинг в production

### Метрики для отслеживания:

```sql
-- 1. Coverage: Сколько креативов имеют метрики
SELECT 
  COUNT(DISTINCT uc.id) as total_creatives,
  COUNT(DISTINCT cmh.creative_id) as creatives_with_metrics,
  ROUND(
    COUNT(DISTINCT cmh.creative_id)::DECIMAL / 
    NULLIF(COUNT(DISTINCT uc.id), 0) * 100, 
    2
  ) as coverage_pct
FROM user_creatives uc
LEFT JOIN ad_creative_mapping acm ON uc.id = acm.user_creative_id
LEFT JOIN creative_metrics_history cmh 
  ON acm.ad_id = cmh.ad_id
  AND cmh.date >= CURRENT_DATE - INTERVAL '2 days'
WHERE uc.status = 'ready';

-- 2. Freshness: Последнее обновление
SELECT 
  user_account_id,
  MAX(date) as last_update,
  CURRENT_DATE - MAX(date) as days_ago
FROM creative_metrics_history
WHERE source = 'production'
GROUP BY user_account_id;

-- 3. Объем данных по дням
SELECT 
  date,
  COUNT(*) as records_count,
  SUM(impressions) as total_impressions
FROM creative_metrics_history
WHERE source = 'production'
  AND date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY date
ORDER BY date DESC;
```

---

## ✅ Критерии успешного тестирования

- [ ] Миграции применены без ошибок
- [ ] Agent-brain запускается без ошибок
- [ ] При ручном запуске scoring agent метрики сохраняются
- [ ] В БД есть записи с source = 'production' за вчера
- [ ] SQL агрегация работает корректно
- [ ] Frontend показывает метрики в ROI аналитике
- [ ] Таблица метрик заполнена данными по дням
- [ ] Агрегация нескольких ads работает (суммирование)
- [ ] Cron запускается автоматически в 8:00
- [ ] Нет дубликатов в БД (UNIQUE constraint работает)

---

## 📞 Поддержка

Если что-то не работает, проверьте:
1. Логи agent-brain
2. Данные в БД через SQL запросы выше
3. Network запросы в браузере (DevTools)
4. Консоль браузера на ошибки

**Важные логи:**
```bash
# Agent-brain
docker logs agents-monorepo-agent-brain-1 --tail 500 | grep -E "saveCreativeMetricsToHistory|scoring_agent"

# Cron
docker logs agents-monorepo-agent-brain-1 --since 24h | grep cron
```


