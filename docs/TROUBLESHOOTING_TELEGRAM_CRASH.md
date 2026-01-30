# Troubleshooting: Moltbot Telegram Crash

**Дата:** 2026-01-30
**Статус:** 🔴 Критично - требует немедленного решения
**Компоненты:** Moltbot Telegram Transport, agent-brain

---

## Проблема

Moltbot **падает при обработке сообщений из Telegram**.

### Симптомы

1. ✅ Telegram транспорт запускается успешно
2. ✅ Бот получает сообщения от пользователей
3. ❌ Контейнер `moltbot` крашится сразу после получения сообщения
4. ❌ Пользователь не получает ответа
5. ⚠️ Контейнер автоматически перезапускается (`restart: unless-stopped`)

### Логи краша

**Последнее полученное сообщение:**
```json
{
  "update_id": 742979269,
  "message": {
    "message_id": 24,
    "from": {
      "id": 313145981,
      "first_name": "Анатолий",
      "username": "anatoliymarketolog"
    },
    "date": 1769745954,
    "text": "Саламалэйкум"
  }
}
```

**Сразу после получения:**
- Контейнер начинает установку пакетов через `apt-get` (признак рестарта)
- `docker ps` показывает `Up X seconds` (контейнер только что перезапустился)

---

## История проблемы

### Предшествующие события

**2026-01-30 07:52** - Deployment новых функций лимитов затрат:
- ✅ Добавлен модуль `usageLimits.js`
- ✅ Интегрирован в `moltbot/orchestrator.js`
- ✅ Обновлена документация
- ✅ Контейнеры пересобраны и перезапущены

**2026-01-30 08:08** - Включение Telegram транспорта:
- Обнаружено что Telegram плагин был `disabled`
- Вручную выполнено:
  ```bash
  docker exec moltbot moltbot plugins enable telegram
  docker exec moltbot moltbot channels add --channel telegram --token "$MOLTBOT_TELEGRAM_BOT_TOKEN"
  docker restart moltbot
  ```
- ✅ Транспорт запустился: `[telegram] [default] starting provider (@Moltbot_prfmnt_bot)`

**2026-01-30 08:08:10** - Первое сообщение и краш:
- Получено сообщение от пользователя 313145981
- Контейнер упал сразу после получения
- Автоматический рестарт через Docker

---

## Возможные причины

### 1. Отсутствие миграции БД ⚠️ **Наиболее вероятная причина**

**Проблема:**
- Код проверяет лимиты через `checkUserLimit(telegramId)`
- Запрашивает таблицы `user_ai_limits` и `user_ai_usage`
- Эти таблицы **НЕ СОЗДАНЫ** (миграция 169 не применена)
- Запрос к несуществующей таблице → SQL ошибка → краш

**Логика в коде (`moltbot/orchestrator.js:122`):**
```javascript
if (context.telegramChatId) {
  const limitCheck = await checkUserLimit(context.telegramChatId);
  // ...
}
```

**В checkUserLimit (`usageLimits.js:133`):**
```javascript
const { data: limit, error: limitError } = await supabase
  .from('user_ai_limits')  // ⚠️ Таблица не существует!
  .select('daily_limit_usd, is_unlimited')
  .eq('telegram_id', telegramId)
  .single();
```

**Fail-open логика:**
```javascript
if (limitError && limitError.code !== 'PGRST116') {
  log.error({ error: limitError, telegramId, code: limitError.code }, 'Database error fetching user limit');
  log.warn({ telegramId }, 'FAIL-OPEN: Allowing request due to DB error');
  return { allowed: true, remaining: 1.00, limit: 1.00, spent: 0, failOpen: true };
}
```

**НО:** Если Supabase возвращает не HTTP ошибку, а бросает exception, fail-open не сработает → uncaught exception → crash.

### 2. Проблема в agent-brain connectivity

**Возможно:**
- Moltbot пытается подключиться к agent-brain
- WebSocket соединение не устанавливается
- Timeout или unhandled rejection → crash

**Но:** В логах нет упоминаний о попытке подключения к agent-brain, значит краш происходит **ДО** отправки к gateway.

### 3. Ошибка в Telegram транспорте

**Маловероятно:**
- Транспорт успешно получает сообщения
- Другие транспорты (если были) работают
- Код Telegram транспорта стабильный (часть Moltbot core)

### 4. Проблема с Skills загрузкой

**Возможно:**
- При обработке сообщения загружаются Skills
- Один из Skills некорректно настроен
- Ошибка парсинга AGENTS.md или других skill файлов

**Логи показывают успешную загрузку:**
```
[skills] Sanitized skill command name "facebook-ads" to "/facebook_ads"
```

---

## Диагностика

### Что НЕ работает

❌ Получить stack trace из логов (контейнер рестартует до вывода)
❌ agent-brain не получает запросы (нет логов)
❌ Telegram bot не отвечает пользователям

### Что работает

✅ Moltbot Gateway слушает на ws://0.0.0.0:18789
✅ agent-brain работает на порту 7080
✅ Telegram транспорт получает сообщения
✅ Skills загружаются успешно

### Что проверить

1. **Применить миграцию БД** (главный приоритет):
   ```sql
   -- Выполнить в Supabase Dashboard → SQL Editor
   -- Файл: migrations/169_user_ai_usage_limits.sql
   ```

2. **Проверить логи с error handling:**
   ```bash
   # После применения миграции отправить тестовое сообщение
   docker logs -f moltbot 2>&1 | grep -i "error\|fail\|crash"
   docker logs -f agents-monorepo-agent-brain-1 2>&1 | grep -i "error\|limit"
   ```

3. **Проверить что таблицы созданы:**
   ```sql
   SELECT table_name
   FROM information_schema.tables
   WHERE table_name IN ('user_ai_limits', 'user_ai_usage');
   ```

4. **Временно отключить проверку лимитов** (если миграция не помогает):
   ```javascript
   // В moltbot/orchestrator.js закомментировать:
   // if (context.telegramChatId) {
   //   const limitCheck = await checkUserLimit(context.telegramChatId);
   //   ...
   // }
   ```

---

## Решение

### Шаг 1: Применить миграцию БД

**Действие:** Выполнить в Supabase Dashboard → SQL Editor

**Файл:** [migrations/169_user_ai_usage_limits.sql](../migrations/169_user_ai_usage_limits.sql)

**Что создаётся:**
- Таблица `user_ai_usage` (метрики использования)
- Таблица `user_ai_limits` (лимиты пользователей)
- SQL функция `increment_usage()` (atomic updates)
- Триггер `create_default_limit()` (auto-create limits)

### Шаг 2: Перезапустить Moltbot

```bash
docker restart moltbot
```

### Шаг 3: Отправить тестовое сообщение

Через Telegram бота @Moltbot_prfmnt_bot отправить любое сообщение.

### Шаг 4: Проверить логи

**Успешная обработка должна показать:**

```bash
# agent-brain логи
{"module":"usageLimits","message":"Starting limit check"}
{"module":"usageLimits","message":"New user detected, creating default limit ($1/day)"}
{"module":"usageLimits","message":"Limit check passed"}
```

**Moltbot логи:**
```
[telegram] update: {...}
[gateway] → agent message seq=X
[gateway] ← agent response
```

---

## Временное решение (Workaround)

Если миграция БД недоступна немедленно, можно временно отключить проверку лимитов:

**Файл:** `services/agent-brain/src/moltbot/orchestrator.js`

```javascript
// ВРЕМЕННО ЗАКОММЕНТИРОВАТЬ блок проверки лимитов (строки ~119-186)

// ========== CHECK USER SPENDING LIMIT ==========
/* TEMPORARILY DISABLED FOR DEBUGGING
if (context.telegramChatId) {
  log.debug({ requestId, telegramChatId: context.telegramChatId }, 'Checking user spending limit...');
  const limitCheck = await checkUserLimit(context.telegramChatId);
  // ... весь блок ...
}
*/
// ================================================
```

**После изменения:**
```bash
docker-compose up -d --build --no-deps agent-brain
docker restart moltbot
```

⚠️ **ВАЖНО:** Это временное решение. Без лимитов пользователи могут генерировать неограниченные затраты на AI API.

---

## Превентивные меры

### 1. Улучшить error handling в checkUserLimit

**Проблема:** Unhandled exceptions могут вызывать краш.

**Решение:** Обернуть в глобальный try-catch:

```javascript
export async function checkUserLimit(telegramId) {
  try {
    // Весь код
  } catch (error) {
    log.error({
      error: error.message,
      stack: error.stack,
      telegramId
    }, 'CRITICAL: Unexpected error in checkUserLimit');

    // ВСЕГДА возвращаем результат (fail-open)
    return {
      allowed: true,
      remaining: 1.00,
      limit: 1.00,
      spent: 0,
      failOpen: true,
      error: error.message
    };
  }
}
```

### 2. Добавить healthcheck для Moltbot

**docker-compose.yml:**
```yaml
moltbot:
  # ...
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:18789/__moltbot__/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 40s
```

### 3. Добавить crash reporting

**В начало orchestrator.js:**
```javascript
process.on('uncaughtException', (error) => {
  log.error({
    error: error.message,
    stack: error.stack
  }, 'UNCAUGHT EXCEPTION - CRASH IMMINENT');

  // Send alert to monitoring
  // process.exit(1); // Let Docker restart
});

process.on('unhandledRejection', (reason, promise) => {
  log.error({
    reason,
    promise
  }, 'UNHANDLED REJECTION');
});
```

### 4. Миграция как часть CI/CD

Добавить автоматическую проверку что все миграции применены перед deployment.

---

## Связанные файлы

**Код с проблемой:**
- [services/agent-brain/src/moltbot/orchestrator.js:119-186](../services/agent-brain/src/moltbot/orchestrator.js)
- [services/agent-brain/src/lib/usageLimits.js:114-232](../services/agent-brain/src/lib/usageLimits.js)

**Миграция:**
- [migrations/169_user_ai_usage_limits.sql](../migrations/169_user_ai_usage_limits.sql)

**Документация:**
- [docs/MOLTBOT_TELEGRAM.md#лимиты-затрат-на-ai](MOLTBOT_TELEGRAM.md#лимиты-затрат-на-ai)

**Коммиты:**
- `cc0b8ef` - feat(agent-brain): Improve spending limits with validation and detailed logging
- `a271928` - docs: Add comprehensive AI spending limits documentation
- `48dcd5d` - fix(agent-brain): Remove extra closing brace in orchestrator.js
- `d09d96b` - fix(agent-brain): Fix supabase import path in usageLimits.js
- `50b532f` - fix(agent-brain): Fix logger import in usageLimits.js

---

## Статус

**Текущий статус:** 🔴 Критичный баг - сервис недоступен для Telegram пользователей

**Действия:**
1. ⏳ Ожидание применения миграции БД
2. ⏳ Тестирование после миграции
3. ⏳ Верификация что краши прекратились

**Ответственный:** Backend team
**ETA решения:** ~5 минут после применения миграции

---

## Обновления

### 2026-01-30 08:15
- ✅ Telegram транспорт успешно включен
- ✅ Канал добавлен и работает
- ❌ Обнаружен краш при обработке сообщений
- 📝 Создана эта документация

### 2026-01-30 XX:XX
_Будет обновлено после применения миграции и тестирования_
