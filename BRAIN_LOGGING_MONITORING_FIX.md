# 🔧 Восстановление логирования username и мониторинга ошибок

**Дата:** 04.11.2025  
**Проблема:** Пропало логирование username в Grafana и не отправлялись отчеты об ошибках в мониторинговый бот

---

## 🐛 Проблемы которые были

### 1. Username не логировался в Grafana
- ❌ При запуске `/api/brain/run` не логировался username
- ❌ В логах scoring agent не было username
- ❌ При критических ошибках не было username
- **Результат:** В Grafana не было возможности фильтровать по пользователям

### 2. Не отправлялись отчеты об ошибках в мониторинговый бот
- ❌ При критических ошибках (403, нет прав, scoring failed) catch блок только логировал ошибку
- ❌ `sendToMonitoringBot` не вызывался при ошибках
- ❌ Администратор не получал уведомления о проблемах
- **Результат:** Ошибки оставались незамеченными

---

## ✅ Что исправлено

### 1. Добавлено логирование username при старте brain_run

**Файл:** `services/agent-brain/src/server.js`  
**Строки:** 1864-1870

```javascript
const ua = await getUserAccount(userAccountId);

// Логируем старт с username для Grafana
fastify.log.info({ 
  where: 'brain_run', 
  phase: 'start', 
  userId: userAccountId,
  username: ua.username 
});
```

**Результат:** ✅ В Grafana теперь видно кто запустил brain_run

---

### 2. Добавлен username во все важные логи

**Scoring Agent:**
```javascript
// Start
fastify.log.info({ 
  where: 'brain_run', 
  phase: 'scoring_start', 
  userId: userAccountId, 
  username: ua.username 
});

// Complete
fastify.log.info({ 
  where: 'brain_run', 
  phase: 'scoring_complete', 
  userId: userAccountId,
  username: ua.username,
  summary: scoringOutput?.summary 
});

// Failed
fastify.log.warn({ 
  where: 'brain_run', 
  phase: 'scoring_failed', 
  userId: userAccountId,
  username: ua.username, 
  error: String(err) 
});
```

**Directions:**
```javascript
fastify.log.info({ 
  where: 'brain_run', 
  phase: 'directions_loaded', 
  userId: userAccountId,
  username: ua.username,
  count: directions.length 
});
```

**Результат:** ✅ Во всех логах brain_run теперь есть username

---

### 3. Расширен catch блок с отправкой в мониторинговый бот

**Файл:** `services/agent-brain/src/server.js`  
**Строки:** 2718-2773

**Что делает:**

1. **Получает username**
   - Если `ua` уже загружен → берет `ua.username`
   - Если нет → пытается загрузить из базы через `getUserAccount()`
   - Если не удалось → использует `'unknown'`

2. **Логирует с username**
   ```javascript
   request.log.error({
     where: 'brain_run',
     phase: 'fatal_error',
     userId: userAccountId,
     username,
     duration,
     error: String(err?.message || err),
     stack: err?.stack
   });
   ```

3. **Отправляет в мониторинговый бот**
   ```javascript
   const errorReport = `❌ КРИТИЧЕСКАЯ ОШИБКА

   Пользователь: ${username}
   User ID: ${userAccountId}
   Длительность: ${duration}ms

   Ошибка: ${String(err?.message || err)}

   Stack:
   ${err?.stack || 'N/A'}`;
   
   await sendToMonitoringBot(uaForMonitoring, errorReport, true);
   ```

**Результат:** ✅ Администратор получает уведомление о любых критических ошибках

---

## 📊 Примеры логов

### До исправления:
```json
{
  "where": "brain_run",
  "phase": "scoring_failed",
  "userId": "18758bb0-c453-49d1-abd1-879f96fd4d4f",
  "error": "Error: FB adsets actions failed: 403"
}
```
❌ Нет username → невозможно быстро идентифицировать пользователя

### После исправления:
```json
{
  "where": "brain_run",
  "phase": "start",
  "userId": "18758bb0-c453-49d1-abd1-879f96fd4d4f",
  "username": "test_user"
}
```
✅ Есть username → можно фильтровать в Grafana по `username="test_user"`

---

## 🎯 Сценарии обработки ошибок

### Сценарий 1: Ошибка прав доступа (403)

**Что происходит:**
1. `scoring_agent` пытается получить adsets
2. Facebook API возвращает 403 (нет прав `ads_management`)
3. catch в `scoring_agent` логирует: `scoring_failed` с username ✅
4. Brain продолжает работу без scoring данных

**Мониторинг:**
- ⚠️ Scoring failed залогирован с username
- ℹ️ Обычный отчет отправляется клиенту и в monitoring bot

---

### Сценарий 2: Критическая ошибка (getUserAccount failed)

**Что происходит:**
1. `getUserAccount()` падает (например, Supabase недоступен)
2. Весь `brain_run` падает в catch на строке 2718
3. catch блок:
   - Пытается получить username ✅
   - Логирует `fatal_error` с username ✅
   - Отправляет в мониторинговый бот с пометкой "❌ КРИТИЧЕСКАЯ ОШИБКА" ✅

**Мониторинг:**
- 🔴 Администратор получает Telegram с полным стеком ошибки
- 📊 В Grafana видно `phase: "fatal_error"` с username

---

### Сценарий 3: Ошибка dispatch actions

**Что происходит:**
1. Actions отправляются в agent-service
2. Dispatch падает (например, invalid action)
3. `dispatchFailed = true`
4. Отчет НЕ отправляется клиенту ✅
5. Отчет отправляется в monitoring bot с флагом `dispatchFailed: true` ✅

**Мониторинг:**
- ⚠️ Администратор получает отчет с пометкой "❌ ОШИБКА ВЫПОЛНЕНИЯ"
- ℹ️ Клиент не получает некорректный отчет

---

## 🔍 Фильтрация в Grafana

Теперь можно использовать:

```grafana
{service="agent-brain"} | json | where="brain_run" | username="test_user"
```

Или:

```grafana
{service="agent-brain"} | json | phase="fatal_error"
```

Или:

```grafana
{service="agent-brain"} | json | where="brain_run" | phase=~"start|scoring_failed|fatal_error"
```

---

## 📝 Monitoring Bot

Теперь администратор получает в Telegram:

### Обычный отчет:
```
📊 ОТЧЁТ КЛИЕНТА
👤 User: test_user
🆔 ID: 18758bb0-c453-49d1-abd1-879f96fd4d4f
━━━━━━━━━━━━━━━━

📅 Дата отчета: 2025-11-04
...
```

### Отчет с ошибкой dispatch:
```
❌ ОШИБКА ВЫПОЛНЕНИЯ
📊 ОТЧЁТ КЛИЕНТА
👤 User: test_user
🆔 ID: 18758bb0-c453-49d1-abd1-879f96fd4d4f
━━━━━━━━━━━━━━━━

📅 Дата отчета: 2025-11-04
...
```

### Критическая ошибка:
```
❌ КРИТИЧЕСКАЯ ОШИБКА

Пользователь: test_user
User ID: 18758bb0-c453-49d1-abd1-879f96fd4d4f
Длительность: 1234ms

Ошибка: Error: FB adsets actions failed: 403 ...

Stack:
Error: FB adsets actions failed: 403
    at fetchAdsetsActions (file:///app/src/scoring.js:215:11)
    ...
```

---

## 🚀 Deployment

### 1. Пересобрать контейнер:
```bash
cd /Users/anatolijstepanov/agents-monorepo
docker-compose build agent-brain
```

### 2. Перезапустить:
```bash
docker-compose up -d agent-brain
```

### 3. Проверить логи:
```bash
docker-compose logs -f agent-brain | grep username
```

---

## ✅ Checklist

- [x] Username логируется при старте brain_run
- [x] Username в логах scoring_start
- [x] Username в логах scoring_complete
- [x] Username в логах scoring_failed
- [x] Username в логах directions_loaded
- [x] Username в логах fatal_error
- [x] Catch блок отправляет в мониторинговый бот
- [x] Отчет об ошибке включает username, userId, duration, stack
- [x] Нет ошибок линтера
- [x] Документация обновлена

---

## 📌 Связанные файлы

- `services/agent-brain/src/server.js` - основной файл с изменениями
- `services/agent-brain/src/scoring.js` - scoring agent (без изменений)
- `services/agent-brain/src/lib/logger.js` - logger конфигурация (без изменений)

---

**Автор исправлений:** AI Assistant  
**Дата:** 04.11.2025  
**Версия:** v1.0









