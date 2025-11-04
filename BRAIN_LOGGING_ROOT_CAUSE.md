# 🔍 Root Cause: Почему пропал username в Grafana

**Дата:** 04.11.2025  
**Проблема:** Username не отображался в логах утреннего батча (03:00)

---

## 📊 Что показывали логи

### Ошибка утром 04.11.2025, 03:00:02:
```json
{
  "level": "error",
  "where": "scoring_agent",
  "phase": "error",
  "userId": "18758bb0-c453-49d1-abd1-879f96fd4d4f",
  "error": "Error: FB adsets actions failed: 403..."
}
```

❌ **НЕТ username!**

---

## 🔎 Root Cause Analysis

### Архитектура логирования

```
CRON (08:00)
  └─> processDailyBatch()
       └─> processUser(user)  ← ✅ Логирует where='processUser', username=user.username
            └─> POST /api/brain/run
                 └─> brain_run  ← ❌ НЕ логирует username при старте
                      └─> runScoringAgent()  ← ❌ НЕ извлекает username из userAccount
                           ├─> logger.info({ where: 'scoring_agent', phase: 'start', userId }) ❌
                           └─> logger.error({ where: 'scoring_agent', phase: 'error', userId }) ❌
```

### Проблема №1: scoring.js НЕ извлекал username

**БЫЛО (строка 644):**
```javascript
const { ad_account_id, access_token, id: userAccountId } = userAccount;
```

❌ Не извлекался `username` из объекта `userAccount`!

**СТАЛО:**
```javascript
const { ad_account_id, access_token, id: userAccountId, username } = userAccount;
```

### Проблема №2: scoring.js НЕ логировал username

**БЫЛО (строка 653, 917):**
```javascript
logger.info({ where: 'scoring_agent', phase: 'start', userId: userAccountId });

logger.error({
  where: 'scoring_agent',
  phase: 'error',
  userId: userAccountId,
  duration,
  error: String(error),
  stack: error.stack
});
```

❌ В логах только `userId`, нет `username`!

**СТАЛО:**
```javascript
logger.info({ where: 'scoring_agent', phase: 'start', userId: userAccountId, username });

logger.error({
  where: 'scoring_agent',
  phase: 'error',
  userId: userAccountId,
  username,  // ← ДОБАВЛЕНО!
  duration,
  error: String(error),
  stack: error.stack
});
```

### Проблема №3: brain_run НЕ логировал username при старте

**БЫЛО:**
```javascript
const ua = await getUserAccount(userAccountId);

// ========================================
// DIRECTIONS - Получаем направления бизнеса
// ========================================
const directions = await getUserDirections(userAccountId);
fastify.log.info({ 
  where: 'brain_run', 
  phase: 'directions_loaded', 
  userId: userAccountId,  // ❌ Нет username
  count: directions.length 
});
```

**СТАЛО:**
```javascript
const ua = await getUserAccount(userAccountId);

// Логируем старт с username для Grafana
fastify.log.info({ 
  where: 'brain_run', 
  phase: 'start', 
  userId: userAccountId,
  username: ua.username  // ✅ ДОБАВЛЕНО!
});

// ========================================
// DIRECTIONS - Получаем направления бизнеса
// ========================================
const directions = await getUserDirections(userAccountId);
fastify.log.info({ 
  where: 'brain_run', 
  phase: 'directions_loaded', 
  userId: userAccountId,
  username: ua.username,  // ✅ ДОБАВЛЕНО!
  count: directions.length 
});
```

### Проблема №4: catch блок НЕ отправлял в мониторинговый бот

**БЫЛО (строка 2709):**
```javascript
  } catch (err) {
    request.log.error(err);  // ❌ Просто логирует объект error
    return reply.code(500).send({ error:'brain_run_failed', details:String(err?.message || err) });
  }
```

❌ Нет:
- username в логах
- отправки в мониторинговый бот
- детальной информации (duration, stack)

**СТАЛО:**
```javascript
  } catch (err) {
    const duration = Date.now() - started;
    
    // Попытаемся получить username
    let username = 'unknown';
    let uaForMonitoring = null;
    try {
      if (typeof ua !== 'undefined' && ua) {
        username = ua.username || 'N/A';
        uaForMonitoring = ua;
      } else if (userAccountId) {
        const tempUa = await getUserAccount(userAccountId).catch(() => null);
        if (tempUa) {
          username = tempUa.username || 'N/A';
          uaForMonitoring = tempUa;
        }
      }
    } catch {}
    
    // Логируем с username для Grafana
    request.log.error({
      where: 'brain_run',
      phase: 'fatal_error',
      userId: userAccountId,
      username,  // ✅ ДОБАВЛЕНО!
      duration,
      error: String(err?.message || err),
      stack: err?.stack
    });
    
    // Отправляем в мониторинговый бот
    if (uaForMonitoring) {
      try {
        const errorReport = `❌ КРИТИЧЕСКАЯ ОШИБКА

Пользователь: ${username}
User ID: ${userAccountId}
Длительность: ${duration}ms

Ошибка: ${String(err?.message || err)}

Stack:
${err?.stack || 'N/A'}`;
        await sendToMonitoringBot(uaForMonitoring, errorReport, true);
      } catch (monitoringErr) {
        request.log.error({
          where: 'brain_run_catch',
          phase: 'monitoring_failed',
          error: String(monitoringErr)
        });
      }
    }
    
    return reply.code(500).send({ error:'brain_run_failed', details:String(err?.message || err) });
  }
```

---

## 🎯 Почему это работало вчера?

**Ответ:** НЕ работало полностью!

Функция `processUser` логировала username, но:
- ✅ Работало только на уровне `where: 'processUser'`
- ❌ НЕ работало на уровне `where: 'scoring_agent'`
- ❌ НЕ работало на уровне `where: 'brain_run'`
- ❌ НЕ работало в критических ошибках (catch блок)

Когда ошибка происходила **внутри** brain_run (например, scoring agent), она логировалась БЕЗ username:
```json
{"where":"scoring_agent","phase":"error","userId":"...","error":"..."}
```

А не:
```json
{"where":"processUser","userId":"...","username":"...","status":"failed"}
```

---

## ✅ Что исправлено

### 1. scoring.js
- ✅ Извлечение username из userAccount
- ✅ Логирование username в phase: 'start'
- ✅ Логирование username в phase: 'error'

### 2. server.js (brain_run)
- ✅ Логирование username при старте brain_run
- ✅ Логирование username в scoring_start
- ✅ Логирование username в scoring_complete
- ✅ Логирование username в scoring_failed
- ✅ Логирование username в directions_loaded
- ✅ Логирование username в fatal_error (catch блок)
- ✅ Отправка критических ошибок в мониторинговый бот

---

## 📊 Теперь в Grafana

### Можно фильтровать:

```grafana
{service="agent-brain"} | json | username="test_user"
```

```grafana
{service="agent-brain"} | json | where="scoring_agent" | phase="error" | username!=""
```

```grafana
{service="agent-brain"} | json | where="brain_run" | phase=~"start|scoring_failed|fatal_error"
```

---

## 📁 Измененные файлы

1. **services/agent-brain/src/scoring.js**
   - Строка 644: добавлен `username` в деструктуризацию
   - Строка 653: добавлен `username` в лог start
   - Строка 921: добавлен `username` в лог error

2. **services/agent-brain/src/server.js**
   - Строки 1865-1870: добавлен лог start с username
   - Строки 1877-1882: добавлен username в лог directions_loaded
   - Строка 1890: добавлен username в лог scoring_start
   - Строка 1903: добавлен username в лог scoring_complete
   - Строка 1911: добавлен username в лог scoring_failed
   - Строки 2720-2773: расширен catch блок с username и отправкой в monitoring bot

---

## 🚀 Deployment

```bash
cd /Users/anatolijstepanov/agents-monorepo
docker-compose build agent-brain
docker-compose up -d agent-brain
docker-compose logs -f agent-brain | grep username
```

---

**Root Cause:** scoring.js не извлекал и не логировал username, brain_run не логировал username при старте и в критических ошибках

**Resolution:** Добавлен username во все ключевые точки логирования + отправка критических ошибок в мониторинговый бот

**Автор:** AI Assistant  
**Дата:** 04.11.2025


