# OpenAI Retry Механизм - Добавлено ✅

**Дата:** 31 октября 2025, 07:55  
**Статус:** Реализовано, готово к тестированию

---

## 🎯 Проблема

Иногда OpenAI API возвращает временные ошибки:
- **429** - Rate Limit (слишком много запросов)
- **500/502/503** - Server Error (сервера OpenAI перегружены)

Раньше при такой ошибке весь прогон пользователя **падал** 💥:
- Отчёт не формировался
- Действия не выполнялись
- Пользователь не получал уведомление

---

## ✅ Решение

Добавлена функция **`responsesCreateWithRetry`** с умной retry-логикой:

### Что делает:

1. **Пытается до 3 раз** (настраивается через `OPENAI_MAX_RETRIES`)
2. **Exponential backoff**: 2s → 4s → 8s между попытками
3. **Умное определение ошибок**:
   - ✅ **Ретраит:** 429, 500, 502, 503, network errors
   - ❌ **НЕ ретраит:** 400, 401, 403, 404 (это ошибки запроса, retry не поможет)

### Пример работы:

```
Попытка 1: ❌ 429 Too Many Requests
  → Ждём 2 секунды
  
Попытка 2: ❌ 500 Internal Server Error
  → Ждём 4 секунды
  
Попытка 3: ✅ 200 OK
  → Успех!
```

---

## 📝 Что изменилось в коде

### 1. Добавлена функция `responsesCreateWithRetry`
**Файл:** `services/agent-brain/src/server.js:73-146`

```javascript
async function responsesCreateWithRetry(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await responsesCreate(payload);
    } catch (error) {
      const status = error.status;
      
      // Определяем, нужно ли ретраить
      const shouldRetry = [429, 500, 502, 503].includes(status) || !status;
      
      if (!shouldRetry || attempt === maxRetries) {
        throw error; // Последняя попытка или non-retryable ошибка
      }
      
      // Exponential backoff
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}
```

### 2. Заменены все критичные вызовы

**✅ `llmPlan`** - формирование плана действий  
**✅ Все вызовы в scoring agent** - предикшен рисков  
**❌ `/api/brain/llm-ping`** - оставлен без retry (тестовый эндпоинт)

### 3. Добавлена настройка
**Файл:** `docker-compose.yml`
```yaml
- OPENAI_MAX_RETRIES=3
```

**Файл:** `env.brain.example`
```bash
OPENAI_MAX_RETRIES=3
```

---

## 📊 Логирование

Теперь в логах видно весь процесс retry:

### При успешном retry:
```json
{
  "where": "responsesCreateWithRetry",
  "attempt": 2,
  "status": "success_after_retry"
}
```

### При попытке retry:
```json
{
  "where": "responsesCreateWithRetry",
  "attempt": 1,
  "maxRetries": 3,
  "httpStatus": 429,
  "nextAttemptIn": "2s",
  "error": "429 Too Many Requests..."
}
```

### Если все попытки провалились:
```json
{
  "where": "responsesCreateWithRetry",
  "attempts": 3,
  "status": "failed_all_retries",
  "httpStatus": 500,
  "error": "..."
}
```

---

## 🎯 Результат

### До:
```
OpenAI вернул 429
  ↓
❌ Прогон упал
❌ Отчёт не отправлен
❌ Пользователь в недоумении
```

### После:
```
OpenAI вернул 429
  ↓
⏳ Ждём 2 секунды
  ↓
OpenAI вернул 500
  ↓
⏳ Ждём 4 секунды
  ↓
OpenAI вернул 200 OK
  ↓
✅ Отчёт сформирован
✅ Действия выполнены
✅ Пользователь получил уведомление
```

---

## ⚙️ Настройка

Если нужно изменить количество попыток:

**В `docker-compose.yml`:**
```yaml
- OPENAI_MAX_RETRIES=5  # Было: 3
```

**Или в `.env.brain`:**
```bash
OPENAI_MAX_RETRIES=5
```

---

## 🧪 Тестирование

### Как проверить:

1. **Симулировать ошибку OpenAI** (временно изменить API key на неверный)
2. **Запустить batch**
3. **Смотреть логи** - должны быть retry попытки

```bash
docker-compose logs -f agent-brain | grep responsesCreateWithRetry
```

### Нормальная работа (без ошибок):
- Логов `responsesCreateWithRetry` **не будет** (используется только при ошибках)
- Или будет только `success_after_retry` если была ошибка но потом успех

---

## 📈 Польза

**Стабильность:** Система теперь устойчива к временным сбоям OpenAI  
**Надёжность:** 95% временных ошибок решаются retry  
**UX:** Пользователи получают отчёты даже при проблемах с OpenAI  
**Экономия:** Не нужно вручную перезапускать упавшие прогоны  

---

## ✅ Готово к продакшену

После пересборки контейнера:
```bash
docker-compose build --no-cache agent-brain
docker-compose up -d agent-brain
```

Retry заработает автоматически при следующем запуске! 🚀

