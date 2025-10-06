# 🧪 ЛОКАЛЬНОЕ ТЕСТИРОВАНИЕ QUICK TEST

## 📅 Дата: 6 октября 2025

---

## ✅ ЧТО ГОТОВО К ТЕСТИРОВАНИЮ

1. **Agent Service (8080)** — создание тестов, cron проверка каждые 5 минут
2. **Analyzer Service (7081)** — LLM анализ результатов
3. **Cron автоматически:**
   - Проверяет impressions каждые 5 минут
   - Паузит AdSet при >= 1000 показов
   - Вызывает LLM анализ
4. **Brain Agent игнорирует** тестовые кампании (префикс "ТЕСТ |")

---

## 🚀 БЫСТРЫЙ СТАРТ

### 1️⃣ Запуск всех сервисов

```bash
cd /Users/anatolijstepanov/agents-monorepo
./start-all-services.sh
```

**Что запустится:**
- Agent Service (port 8080) с cron
- Analyzer Service (port 7081) для LLM

**Проверка логов:**
```bash
# Agent Service
tail -f /tmp/agent-service.log

# Analyzer Service
tail -f /tmp/analyzer-service.log
```

---

### 2️⃣ Запуск теста

```bash
./test-creative-quick-test.sh
```

**Что делает скрипт:**
1. Проверяет что сервисы работают
2. Очищает старые тесты
3. Создает новый тест
4. Проверяет формат названия кампании
5. Мониторит статус каждые 30 секунд
6. Показывает финальный результат с LLM анализом

**Пример вывода:**
```
╔═══════════════════════════════════════════════════════════════════╗
║  🧪 ЛОКАЛЬНОЕ ТЕСТИРОВАНИЕ QUICK TEST КРЕАТИВОВ                  ║
╚═══════════════════════════════════════════════════════════════════╝

1️⃣  Проверяем сервисы...
✅ Agent Service (8080) работает
✅ Analyzer Service (7081) работает

2️⃣  Очищаем старые тесты...
✅ Старые тесты удалены

3️⃣  Запускаем новый тест...
{
  "success": true,
  "test_id": "uuid",
  "campaign_id": "120236...",
  "adset_id": "120236...",
  "ad_id": "120236...",
  "message": "Creative test started. Budget: $20/day, Target: 1000 impressions"
}

✅ Тест создан! Test ID: uuid

4️⃣  Проверяем название кампании...
Campaign Name: ТЕСТ | Ad: 48b5599f | 2025-10-06 | Проверка токена v2
✅ Название начинается с 'ТЕСТ |' - Brain Agent будет игнорировать!

5️⃣  Мониторинг теста...
[10:30:15] Status: RUNNING | Impressions: 0/1000
[10:30:45] Status: RUNNING | Impressions: 123/1000
[10:31:15] Status: RUNNING | Impressions: 456/1000
[10:31:45] Status: RUNNING | Impressions: 789/1000
[10:32:15] Status: RUNNING | Impressions: 1024/1000

╔═══════════════════════════════════════════════════════════════════╗
║  ✅ ТЕСТ ЗАВЕРШЕН!                                               ║
╚═══════════════════════════════════════════════════════════════════╝

📊 РЕЗУЛЬТАТЫ:
   Status: COMPLETED
   Impressions: 1024/1000
   LLM Score: 78/100
   LLM Verdict: Good
```

---

## 🔧 РУЧНОЕ ТЕСТИРОВАНИЕ

### Создание теста вручную

```bash
curl -X POST http://localhost:8080/api/creative-test/start \
  -H "Content-Type: application/json" \
  -d '{
    "user_creative_id": "48b5599f-68d5-4142-8e63-5f8d109439b8",
    "user_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
  }'
```

### Проверка статуса теста

```bash
source .env.agent

TEST_ID="your-test-id"

curl -s "${SUPABASE_URL}/rest/v1/creative_tests?id=eq.${TEST_ID}&select=*" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE}" | python3 -m json.tool
```

### Ручной вызов анализатора

```bash
curl -X POST http://localhost:7081/api/analyzer/analyze-test \
  -H "Content-Type: application/json" \
  -d '{"test_id": "your-test-id"}'
```

---

## 📊 КАК РАБОТАЕТ CRON

**Расписание:** Каждые 5 минут

**Что делает:**
1. Ищет все тесты со `status = 'running'`
2. Для каждого теста:
   - Получает метрики из Facebook API
   - Обновляет `impressions`, `spend`, `leads` и т.д. в Supabase
   - Проверяет условие завершения (`impressions >= 1000`)
3. Если лимит достигнут:
   - **Паузит AdSet** через Facebook API
   - **Вызывает Analyzer Service** для LLM анализа
   - Обновляет `status = 'completed'`

**Логи cron:**
```bash
tail -f /tmp/agent-service.log | grep Cron
```

**Пример логов:**
```
[Cron] Checking running creative tests...
[Cron] Found 1 running test(s)
[Cron] Test uuid: 456/1000 impressions
[Cron] Test uuid: 789/1000 impressions
[Cron] Test uuid: 1024/1000 impressions
[Cron] Test uuid reached limit, pausing AdSet and triggering analyzer
[Cron] AdSet 120236... paused successfully
[Cron] Test uuid analyzed successfully
```

---

## 🧠 ANALYZER SERVICE

**Что анализирует LLM:**
- 📊 Метрики: impressions, reach, clicks, CTR, CPM, CPL
- 📹 Видео: views, watch time, completion rates
- 📝 Текст: транскрипция видео (если есть)
- 💰 Эффективность: spend vs results

**Что возвращает:**
```json
{
  "score": 78,
  "verdict": "Good",
  "reasoning": "Хорошие показатели CTR и просмотров...",
  "video_analysis": "Видео удерживает внимание...",
  "text_recommendations": "Улучшить CTA в начале...",
  "transcript_match_quality": "high",
  "transcript_suggestions": [
    {
      "from": "старый текст",
      "to": "новый текст",
      "reason": "Улучшит конверсию"
    }
  ]
}
```

---

## 🎯 ФОРМАТ НАЗВАНИЯ ТЕСТОВОЙ КАМПАНИИ

**Формат:**
```
ТЕСТ | Ad: {creative_id} | {дата} | {название}
```

**Пример:**
```
ТЕСТ | Ad: 48b5599f | 2025-10-06 | Проверка токена v2
```

**Зачем это нужно:**
- Brain Agent **автоматически игнорирует** кампании с префиксом "ТЕСТ |"
- Бюджет тестовых кампаний **не учитывается** в общем дневном лимите
- Brain Agent **не применяет действия** к тестовым кампаниям

---

## 🐛 ОТЛАДКА

### Проблема: Сервисы не запускаются

```bash
# Проверить порты
lsof -i:8080
lsof -i:7081

# Убить старые процессы
lsof -ti:8080 | xargs kill -9
lsof -ti:7081 | xargs kill -9

# Запустить снова
./start-all-services.sh
```

### Проблема: Cron не работает

**Проверить логи:**
```bash
tail -f /tmp/agent-service.log | grep Cron
```

**Должно быть:**
```
📅 Creative test cron started (runs every 5 minutes)
```

**Если нет — проверить `dist/cron/creativeTestChecker.js` после build**

### Проблема: Analyzer не отвечает

```bash
# Проверить логи
tail -f /tmp/analyzer-service.log

# Проверить процесс
ps aux | grep analyzer

# Перезапустить
cd services/agent-brain
npm run start:analyzer > /tmp/analyzer-service.log 2>&1 &
```

### Проблема: Тест создается, но не завершается

**Возможные причины:**
1. Cron не работает → проверить логи
2. Facebook API не отдает метрики → проверить access_token
3. Analyzer недоступен → проверить порт 7081

**Ручная проверка:**
```bash
# 1. Проверить что тест в running
source .env.agent
curl -s "${SUPABASE_URL}/rest/v1/creative_tests?status=eq.running&select=id,impressions" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE}"

# 2. Имитировать cron (вызвать check endpoint)
curl -X POST http://localhost:8080/api/creative-test/check/TEST_ID
```

---

## 📝 ОСТАНОВКА СЕРВИСОВ

```bash
# Найти процессы
ps aux | grep "npm start"
ps aux | grep "start:analyzer"

# Убить по PID
kill <PID>

# Или по портам
lsof -ti:8080 | xargs kill -9
lsof -ti:7081 | xargs kill -9
```

---

## ✅ ЧЕКЛИСТ ПЕРЕД ДЕПЛОЕМ

- [ ] Локальное тестирование пройдено успешно
- [ ] Cron работает корректно (паузит AdSet при 1000 показов)
- [ ] Analyzer анализирует и возвращает результаты
- [ ] Brain Agent игнорирует тестовые кампании
- [ ] Формат названия правильный ("ТЕСТ | Ad: ...")
- [ ] Логи чистые (нет ошибок)

---

## 🚀 СЛЕДУЮЩИЕ ШАГИ

После успешного локального тестирования:
1. Задеплоить на продакшен
2. Настроить Nginx для Analyzer Service
3. Обновить `.env` на сервере (ANALYZER_URL)
4. Перезапустить Docker контейнеры
5. Протестировать на проде

---

**Готово к тестированию!** 🎉

