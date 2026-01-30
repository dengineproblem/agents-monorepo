# Решение проблемы: Moltbot Telegram Crash

**Дата:** 2026-01-30
**Статус:** 🔴 Требует немедленного действия
**Ответственный:** Admin (применить миграцию в Supabase)

---

## Краткое описание проблемы

Moltbot **падает при обработке любого сообщения из Telegram**:
- ✅ Telegram транспорт запускается
- ✅ Сообщения получаются
- ❌ Контейнер крашится сразу после получения
- ❌ Пользователь не получает ответа
- 🔄 Контейнер автоматически перезапускается

**Причина:** Код проверяет лимиты затрат через таблицы `user_ai_limits` и `user_ai_usage`, но эти таблицы **НЕ СОЗДАНЫ** в production БД (миграция 169 не применена).

---

## ✅ Решение (3 шага, ~2 минуты)

### Шаг 1: Применить миграцию БД

**1.1. Открыть Supabase Dashboard → SQL Editor**

**1.2. Скопировать содержимое файла:**
```bash
cat /Users/anatolijstepanov/agents-monorepo/migrations/169_user_ai_usage_limits.sql
```

**1.3. Вставить в SQL Editor и выполнить**

**1.4. Проверить что таблицы созданы:**
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('user_ai_limits', 'user_ai_usage');
```

Должно вернуть:
```
table_name
-----------------
user_ai_limits
user_ai_usage
```

---

### Шаг 2: Перезапустить Moltbot

```bash
docker restart moltbot
```

**Ожидается:**
- Контейнер запускается (~30 секунд)
- Telegram транспорт стартует: `[telegram] [default] starting provider (@Moltbot_prfmnt_bot)`
- Больше НЕТ рестартов после получения сообщений

---

### Шаг 3: Проверить работу

**3.1. Отправить тестовое сообщение через Telegram:**

Открыть @Moltbot_prfmnt_bot и написать:
```
привет
```

**3.2. Проверить логи agent-brain:**

```bash
docker logs agents-monorepo-agent-brain-1 --tail 50 | grep -E "usageLimits|limit"
```

**Ожидаемый результат (успех):**
```json
{"module":"usageLimits","message":"Starting limit check"}
{"module":"usageLimits","message":"New user detected, creating default limit ($1/day)"}
{"module":"usageLimits","message":"Limit check passed"}
```

**3.3. Проверить логи Moltbot:**

```bash
docker logs moltbot --tail 30
```

**Ожидаемый результат (успех):**
```
[telegram] update: {"message":{"text":"привет"}}
[gateway] → agent message seq=X
[gateway] ← agent response
```

**НЕ должно быть:**
- Установки пакетов через `apt-get`
- Строки `Get:1 http://deb.debian.org/debian`
- Рестарта контейнера (проверить `docker ps` - Up время НЕ должно обнуляться)

---

### Шаг 4 (опционально): Проверить БД

```sql
-- Проверить что лимит создался
SELECT telegram_id, daily_limit_usd, is_unlimited
FROM user_ai_limits
ORDER BY created_at DESC
LIMIT 5;

-- Проверить что usage записывается
SELECT telegram_id, date, model, cost_usd, request_count
FROM user_ai_usage
WHERE date = CURRENT_DATE
ORDER BY created_at DESC
LIMIT 10;
```

---

## ⚠️ Временное решение (если миграция недоступна сейчас)

Если нельзя применить миграцию немедленно, можно **временно отключить проверку лимитов**:

**Файл:** `services/agent-brain/src/moltbot/orchestrator.js`

**Закомментировать блок (строки ~119-186):**

```javascript
// ========== CHECK USER SPENDING LIMIT ==========
/* TEMPORARILY DISABLED - MISSING DB MIGRATION
if (context.telegramChatId) {
  log.debug({ requestId, telegramChatId: context.telegramChatId }, 'Checking user spending limit...');
  const limitCheck = await checkUserLimit(context.telegramChatId);
  // ... весь блок до ...
}
*/
// ================================================
```

**После изменения пересобрать:**
```bash
docker-compose up -d --build --no-deps agent-brain
docker restart moltbot
```

**⚠️ ВАЖНО:** Это временное решение! Без лимитов пользователи могут генерировать неограниченные затраты на AI API.

---

## 📊 Мониторинг после исправления

### Проверить затраты за сегодня

```sql
SELECT
  telegram_id,
  SUM(cost_usd) as total_spent,
  SUM(request_count) as total_requests,
  COUNT(DISTINCT model) as models_used
FROM user_ai_usage
WHERE date = CURRENT_DATE
GROUP BY telegram_id
ORDER BY total_spent DESC;
```

### Проверить пользователей близких к лимиту

```sql
SELECT
  l.telegram_id,
  l.daily_limit_usd as limit,
  COALESCE(SUM(u.cost_usd), 0) as spent,
  l.daily_limit_usd - COALESCE(SUM(u.cost_usd), 0) as remaining,
  ROUND((COALESCE(SUM(u.cost_usd), 0) / l.daily_limit_usd * 100), 1) as usage_percent
FROM user_ai_limits l
LEFT JOIN user_ai_usage u ON l.telegram_id = u.telegram_id AND u.date = CURRENT_DATE
GROUP BY l.telegram_id, l.daily_limit_usd
HAVING COALESCE(SUM(u.cost_usd), 0) / l.daily_limit_usd >= 0.8
ORDER BY usage_percent DESC;
```

### Проверить fail-open случаи (ошибки БД)

```bash
docker logs agents-monorepo-agent-brain-1 --since 1h | grep "FAIL-OPEN"
```

Если есть результаты - значит проблемы с БД продолжаются.

---

## 🎯 Критерии успеха

После применения миграции и перезапуска:

- ✅ Moltbot НЕ рестартует после получения сообщений
- ✅ agent-brain логирует `"Starting limit check"` и `"Limit check passed"`
- ✅ Telegram бот отвечает на сообщения
- ✅ В БД создаются записи в `user_ai_limits` и `user_ai_usage`
- ✅ Нет ошибок `FAIL-OPEN` в логах

---

## Связанные файлы

- **Миграция:** [migrations/169_user_ai_usage_limits.sql](../migrations/169_user_ai_usage_limits.sql)
- **Код проверки лимитов:** [services/agent-brain/src/lib/usageLimits.js](../services/agent-brain/src/lib/usageLimits.js)
- **Интеграция в orchestrator:** [services/agent-brain/src/moltbot/orchestrator.js:119-186](../services/agent-brain/src/moltbot/orchestrator.js)
- **Полная диагностика:** [docs/TROUBLESHOOTING_TELEGRAM_CRASH.md](./TROUBLESHOOTING_TELEGRAM_CRASH.md)
- **Документация лимитов:** [docs/MOLTBOT_TELEGRAM.md#лимиты-затрат-на-ai](./MOLTBOT_TELEGRAM.md#лимиты-затрат-на-ai)

---

## История

### 2026-01-30 04:08
- ✅ Telegram транспорт включен
- ✅ Получено тестовое сообщение "Саламалэйкум"
- ❌ Контейнер упал сразу после получения
- 📝 Проблема задокументирована

### 2026-01-30 05:00
- 📋 Создана инструкция по решению
- ⏳ Ожидание применения миграции

---

**ETA решения:** ~2 минуты после применения миграции в Supabase Dashboard
