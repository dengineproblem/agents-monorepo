# 🔧 ИСПРАВЛЕНИЕ КРОНА КРЕАТИВ ТЕСТОВ

## 📅 Дата: 9 октября 2025

---

## 🐛 ПРОБЛЕМА

Крон обновлял метрики каждые 5 минут, но когда тест достиг >1000 показов:
- ❌ Campaign НЕ остановился (продолжал работать и тратить бюджет)
- ❌ Анализ НЕ был проведен
- ✅ Статус стал `completed` (но без анализа и без остановки)

## 🔍 ПРИЧИНЫ

### 1. **Analyzer сервис не был запущен**
   - `analyzerService.js` (порт 7081) не был в docker-compose
   - `ANALYZER_URL` не был настроен в agent-service
   - Крон пытался вызвать `http://localhost:7081/api/analyzer/analyze-test` → Connection refused
   - Без analyzer'а LLM анализ не проводился (все `llm_*` поля оставались `null`)

### 2. **Останавливался AdSet вместо Campaign**
   - Старый код: `axios.post('https://graph.facebook.com/v20.0/${test.adset_id}', {status: 'PAUSED'})`
   - Проблема: останавливался только adset, а не вся кампания
   - Campaign продолжал работать и тратить бюджет
   - **Решение:** Теперь используется `fb.pauseCampaign(test.campaign_id)` - та же функция что в actions

### 3. **Недостаточное логирование**
   - Ошибки логировались только как `[Cron] Error checking test xxx:`
   - Детали ошибки (response от Facebook/Analyzer) не выводились
   - Невозможно было понять почему не работает

### 4. **Статус `completed` ставился неправильно**
   - Статус менялся на `completed` ТОЛЬКО если analyzer падал
   - Если analyzer успешно отработал, статус НЕ менялся
   - **Решение:** Теперь статус ВСЕГДА меняется на `completed` после достижения лимита

---

## ✅ ЧТО ИСПРАВЛЕНО

### 1. Добавлен Creative Analyzer в docker-compose.yml
```yaml
creative-analyzer:
  build: ./services/agent-brain
  env_file:
    - ./.env.brain
  environment:
    - ANALYZER_PORT=7081
  command: node src/analyzerService.js
  ports:
    - "7081:7081"
  restart: unless-stopped
```

### 2. Настроен ANALYZER_URL в agent-service
```yaml
agent-service:
  environment:
    - ANALYZER_URL=http://creative-analyzer:7081  # Новая переменная!
```

### 3. Исправлена остановка Campaign
```typescript
// Было (НЕ РАБОТАЛО):
await axios.post(`https://graph.facebook.com/v20.0/${test.adset_id}`, {
  access_token: userAccount.access_token,
  status: 'PAUSED'
});

// Стало (РАБОТАЕТ):
await fb.pauseCampaign(test.campaign_id, userAccount.access_token);
// ^ Используем ту же функцию что и в actions роуте!
```

### 4. Улучшено логирование в creativeTestChecker.ts
```typescript
// Теперь видно:
✅ ANALYZER_URL при старте крона
✅ Детальные ошибки от Facebook API (response.data, status)
✅ Детальные ошибки от Analyzer (code, message, response)
✅ Статус паузы Campaign и успешность анализа
```

### 5. Статус всегда меняется на completed
```typescript
// ВСЕГДА помечаем тест как completed после достижения лимита
// (независимо от успеха паузы Campaign или анализа)
try {
  await supabase
    .from('creative_tests')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', test.id);
  
  app.log.info(`Test ${test.id} marked as completed. Campaign paused: ${campaignPaused}, Analyzer success: ${analyzerSuccess}`);
} catch (updateError) {
  app.log.error('Failed to update test status:', updateError);
}
```

---

## 🚀 КАК ЗАДЕПЛОИТЬ

### На локальной машине (MacOS):

```bash
# 1. Перейти в директорию проекта
cd /Users/anatolijstepanov/agents-monorepo

# 2. Коммит изменений
git add .
git commit -m "fix: creative test cron - add analyzer service, pause campaign instead of adset, improve logging"

# 3. Пуш на сервер
git push origin main
```

---

### На сервере (Ubuntu):

```bash
# 1. SSH на сервер
ssh root@147.182.186.15

# 2. Перейти в директорию проекта
cd /root/agents-monorepo

# 3. Подтянуть изменения
git pull origin main

# 4. Пересобрать и перезапустить все сервисы
docker-compose down
docker-compose up -d --build

# 5. Проверить что все запустилось
docker-compose ps

# Должно быть 3 сервиса:
# - agents-monorepo-agent-brain-1 (7080)
# - agents-monorepo-creative-analyzer-1 (7081)  ← НОВЫЙ!
# - agents-monorepo-agent-service-1 (8080)

# 6. Проверить логи
docker-compose logs agent-service | grep "ANALYZER_URL"
# Должно быть: ANALYZER_URL: http://creative-analyzer:7081
```

---

## 🧪 КАК ПРОВЕРИТЬ

### 1. Проверка что analyzer запущен

```bash
# Health check analyzer
curl http://localhost:7081/health

# Ожидаемый ответ:
# {"ok":true,"service":"creative-analyzer"}
```

### 2. Проверка логов крона

```bash
# Смотрим логи agent-service
docker-compose logs -f agent-service | grep Cron

# Должны быть логи каждые 5 минут:
# [Cron] Checking running creative tests...
# [Cron] Found X running test(s)
```

### 3. Запустить новый тест

Если есть running тесты, они будут обработаны при следующем запуске крона (максимум через 5 минут).

Когда тест достигнет 1000 показов, в логах должно быть:

```
[Cron] Test xxx reached limit (1008/1000), pausing Campaign and triggering analyzer
[Cron] Campaign xxx paused successfully
[Cron] Calling analyzer at http://creative-analyzer:7081/api/analyzer/analyze-test for test xxx
[Cron] Test xxx analyzed successfully
[Cron] Test xxx marked as completed. Campaign paused: true, Analyzer success: true
```

### 4. Проверка в базе данных

```sql
-- Проверить что LLM поля заполнены
SELECT 
  id,
  status,
  impressions,
  llm_score,
  llm_verdict,
  llm_reasoning,
  created_at,
  completed_at
FROM creative_tests
WHERE id = 'xxx'  -- ID теста
LIMIT 1;
```

**Ожидаемый результат:**
- `status` = `'completed'`
- `llm_score` = число от 0 до 100
- `llm_verdict` = `'excellent'|'good'|'average'|'poor'`
- `llm_reasoning` = текст анализа

### 5. Проверка что Campaign остановлен

```bash
# Через Facebook Graph API
curl "https://graph.facebook.com/v20.0/{campaign_id}?fields=status,effective_status&access_token={token}"

# Ожидаемый результат:
# {"status":"PAUSED","effective_status":"PAUSED"}
```

---

## 📝 ИЗМЕНЕННЫЕ ФАЙЛЫ

1. ✅ `docker-compose.yml` - добавлен creative-analyzer сервис
2. ✅ `services/agent-service/src/cron/creativeTestChecker.ts` - паузится campaign, улучшено логирование
3. ✅ `services/agent-service/src/workflows/creativeTest.ts` - добавлены логи и обработка ошибок

---

## 🎯 ИТОГ

Теперь крон будет:
1. ✅ Обновлять метрики каждые 5 минут (используя `date_preset: 'today'`)
2. ✅ Останавливать **весь Campaign** при достижении лимита (через `fb.pauseCampaign()`)
3. ✅ Вызывать analyzer для анализа результатов
4. ✅ Сохранять результаты анализа в базу (llm_score, llm_verdict и т.д.)
5. ✅ Детально логировать все ошибки с полным response от API

**Готово к деплою!** 🚀
