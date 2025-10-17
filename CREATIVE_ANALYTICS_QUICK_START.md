# 🚀 Creative Analytics - Быстрый старт

**Дата:** 17 октября 2025

---

## ⚡ Что сделано?

Добавлен **новый API** для получения полной аналитики креативов:
- ✅ Автоматически выбирает данные: production или тест
- ✅ Единый скоринг через LLM (как в тестах)
- ✅ Кеш на 10 минут (защита от частых запросов)
- ✅ Видео метрики включены
- ✅ НЕ трогает существующий тестовый flow

---

## 📦 Что изменилось?

### Измененные файлы:

1. **`services/agent-brain/src/analyzerService.js`**
   - ✅ Добавлена система кеширования
   - ✅ Функция `fetchProductionMetrics()` для Facebook API
   - ✅ Новый endpoint `GET /api/analyzer/creative-analytics/:id`
   - ⚠️ Старый endpoint `/api/analyzer/analyze-test` НЕ ТРОНУТ

### Новые файлы:

2. **`CREATIVE_ANALYTICS_API.md`** - Полная документация API
3. **`CREATIVE_ANALYTICS_QUICK_START.md`** - Этот файл

---

## 🏃 Быстрый запуск

### Шаг 1: Убедиться что analyzer-service работает

```bash
curl http://localhost:7081/health
# Должен вернуть: {"ok":true,"service":"creative-analyzer"}
```

Если не работает:
```bash
cd services/agent-brain
ANALYZER_PORT=7081 \
OPENAI_API_KEY=sk-... \
SUPABASE_URL=https://... \
SUPABASE_SERVICE_ROLE_KEY=... \
node src/analyzerService.js
```

### Шаг 2: Получить ID креатива

Из Supabase или фронта:
```sql
SELECT id, title FROM user_creatives WHERE user_id = 'YOUR_USER_ID';
```

### Шаг 3: Запросить аналитику

```bash
curl "http://localhost:7081/api/analyzer/creative-analytics/CREATIVE_ID?user_id=USER_ID"
```

**Пример:**
```bash
curl "http://localhost:7081/api/analyzer/creative-analytics/abc-123-456?user_id=def-789-012" | jq
```

---

## 📊 Примеры ответов

### Креатив в production (используется в рекламе)

```json
{
  "creative": {
    "id": "abc-123",
    "title": "Осенняя акция",
    "direction_name": "Имплантация"
  },
  "data_source": "production",
  "production": {
    "in_use": true,
    "metrics": {
      "impressions": 45230,
      "cpl_cents": 198,
      "video_views_75_percent": 14000
    }
  },
  "analysis": {
    "score": 72,
    "verdict": "good",
    "based_on": "production"
  },
  "from_cache": false
}
```

### Только тест (не в production)

```json
{
  "data_source": "test",
  "test": {
    "metrics": {
      "impressions": 1050,
      "cpl_cents": 150
    }
  },
  "production": null,
  "analysis": {
    "score": 75,
    "based_on": "test"
  }
}
```

### Нет данных

```json
{
  "data_source": "none",
  "message": "Креатив не тестировался и не используется в рекламе",
  "analysis": null
}
```

---

## 🧪 Проверка кеша

```bash
# Первый запрос (медленно, ~3 сек - вызов LLM)
time curl "http://localhost:7081/api/analyzer/creative-analytics/abc?user_id=123"

# Второй запрос сразу после (быстро, <100ms - из кеша)
time curl "http://localhost:7081/api/analyzer/creative-analytics/abc?user_id=123"
# Ответ будет содержать: "from_cache": true

# Принудительное обновление (игнорировать кеш)
curl "http://localhost:7081/api/analyzer/creative-analytics/abc?user_id=123&force=true"
```

---

## 🔍 Логи для отладки

### Смотреть логи analyzer-service

```bash
# Docker
docker logs agents-monorepo-agent-brain-1 --tail 100 -f | grep creative-analytics

# Локальный запуск
# Логи будут в stdout
```

### Что искать в логах:

**Успешный запрос:**
```
INFO: Fetching creative analytics { user_creative_id: 'abc', user_id: '123' }
INFO: Production metrics found { impressions: 45230 }
INFO: Analyzing with LLM { data_source: 'production' }
INFO: LLM analysis complete { llm_score: 72, llm_verdict: 'good' }
```

**Из кеша:**
```
INFO: Returning cached analytics { user_creative_id: 'abc', from_cache: true }
```

**Ошибки:**
```
ERROR: Creative not found { user_creative_id: 'abc' }
ERROR: FB production insights failed: 400 ...
```

---

## 🎨 Интеграция с фронтом

### React/Vue пример

```javascript
async function loadCreativeAnalytics(creativeId, userId) {
  const response = await fetch(
    `http://localhost:7081/api/analyzer/creative-analytics/${creativeId}?user_id=${userId}`
  );
  
  const data = await response.json();
  
  if (data.data_source === 'none') {
    // Креатив не тестировался и не в production
    return { message: 'Нет данных' };
  }
  
  if (data.data_source === 'production') {
    // Показываем production метрики
    return {
      source: 'Production',
      metrics: data.production.metrics,
      score: data.analysis.score,
      verdict: data.analysis.verdict
    };
  }
  
  // Показываем результаты теста
  return {
    source: 'Тест',
    metrics: data.test.metrics,
    score: data.analysis.score,
    verdict: data.analysis.verdict
  };
}
```

### Отображение скоринга

```javascript
function renderScore(score, verdict) {
  const emoji = {
    excellent: '⭐⭐⭐',
    good: '⭐⭐',
    average: '⭐',
    poor: '❌'
  };
  
  return `${score}/100 ${emoji[verdict]} (${verdict})`;
}
```

---

## ⚠️ Важные моменты

### 1. Кеш работает на уровне сервиса
- Каждый analyzer-service имеет свой кеш в памяти
- При перезапуске сервиса кеш очищается (не критично)
- Кеш НЕ синхронизируется между инстансами

### 2. Production приоритетнее теста
- Если креатив используется в рекламе → всегда анализ по production
- Тест виден в ответе, но не используется для скоринга
- Это ОЖИДАЕМОЕ поведение (реальные данные актуальнее)

### 3. LLM запросы
- Только при первом запросе или после 10 минут
- Стоимость: ~$0.01-0.02 на запрос (gpt-4o)
- Кеш защищает от случайных спамов

### 4. Видео метрики
- Включены только если креатив - видео
- Если креатива нет в production → видео метрики из теста
- Процент досмотра считается автоматически

---

## 🐛 Типичные проблемы

### Проблема: "Creative not found"
**Решение:** Проверьте что `user_creative_id` и `user_id` совпадают

### Проблема: "User account not found"
**Решение:** Проверьте что пользователь есть в `user_accounts`

### Проблема: "FB production insights failed: 400"
**Решение:** 
- Проверьте `access_token` в `user_accounts`
- Проверьте что `fb_creative_id_*` заполнен
- Это не ошибка - креатив просто не используется в рекламе

### Проблема: Медленные ответы
**Решение:**
- Проверьте работает ли кеш (`from_cache: true`)
- Первый запрос всегда медленный (LLM)
- Если все запросы медленные - проблема с OpenAI API

---

## 📚 Дополнительная документация

- **Полная документация API:** `CREATIVE_ANALYTICS_API.md`
- **Архитектура проекта:** `PROJECT_OVERVIEW_RU.md`
- **Тестирование креативов:** `CREATIVE_TEST_FLOW.md`

---

## ✅ Чеклист для деплоя

- [ ] analyzer-service запущен и отвечает на `/health`
- [ ] Проверен один запрос для креатива в production
- [ ] Проверен один запрос для креатива с тестом
- [ ] Проверена работа кеша (второй запрос быстрый)
- [ ] Проверены логи (нет ошибок)
- [ ] Фронт интегрирован и отображает данные

---

## 🎉 Готово!

Теперь у вас есть:
- ✅ API для получения аналитики креативов
- ✅ Защита от частых LLM запросов
- ✅ Единый формат скоринга
- ✅ Автоматический выбор актуальных данных

**Следующие шаги:**
1. Протестировать локально
2. Интегрировать с фронтом
3. Задеплоить на production
4. Собирать обратную связь от пользователей

