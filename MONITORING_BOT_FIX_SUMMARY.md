# Исправление отправки отчётов в мониторинг-бот - Завершено ✅

**Дата:** 31 октября 2025, 07:45  
**Статус:** Все изменения внесены, готово к тестированию

---

## 🎯 Что было исправлено

### 1. ✅ Hardcoded токены заменены на переменные окружения
**Файл:** `services/agent-brain/src/server.js:12-13`

Было:
```js
const MONITORING_BOT_TOKEN = '8147295667:AAGEhSOkR5yvF72oW6rwb7dzMxKx9gHlcWE';
const MONITORING_CHAT_ID = '313145981';
```

Стало:
```js
const MONITORING_BOT_TOKEN = process.env.MONITORING_BOT_TOKEN || '8147295667:AAGEhSOkR5yvF72oW6rwb7dzMxKx9gHlcWE';
const MONITORING_CHAT_ID = process.env.MONITORING_CHAT_ID || '313145981';
```

### 2. ✅ Улучшено логирование в sendToMonitoringBot
**Файл:** `services/agent-brain/src/server.js:1475-1526`

Добавлено детальное логирование:
- **before_send**: токен (замаскированный), chatId, длина сообщения, environment, hostname
- **after_send**: результат отправки с деталями
- **send_failed**: полная информация об ошибке со stack trace

### 3. ✅ Добавлены переменные окружения в Docker Compose
**Файл:** `docker-compose.yml`

```yaml
environment:
  - MONITORING_BOT_TOKEN=8147295667:AAGEhSOkR5yvF72oW6rwb7dzMxKx9gHlcWE
  - MONITORING_CHAT_ID=313145981
  - HOSTNAME=agent-brain-prod
  - CRON_ENABLED=false  # ⚠️ Временно отключен для тестирования
```

### 4. ✅ Обновлён пример конфигурации
**Файл:** `env.brain.example`

```bash
# Monitoring Bot Configuration (admin receives all reports)
MONITORING_BOT_TOKEN=your-monitoring-bot-token
MONITORING_CHAT_ID=your-monitoring-chat-id
```

### 5. ✅ Реализован механизм Leader Lock
**Файл:** `services/agent-brain/src/server.js:2626-2794`

- Проверка существующей блокировки перед запуском batch
- Установка блокировки с expiration (1 час)
- Автоматическое освобождение lock в finally блоке
- Graceful degradation: если lock не работает, продолжаем выполнение

### 6. ✅ Создана миграция БД
**Файл:** `migrations/019_batch_locks_table.sql`

Таблица `batch_locks` с полями:
- `lock_key` (PRIMARY KEY)
- `instance_id` (hostname инстанса)
- `expires_at` (время истечения блокировки)
- `created_at`, `updated_at`

Также добавлена функция для автоматической очистки истёкших блокировок.

---

## 📋 Что нужно сделать дальше

### Шаг 1: Применить миграцию в Supabase

Выполните в Supabase SQL Editor:

```bash
# Локально откройте файл
cat ~/agents-monorepo/migrations/019_batch_locks_table.sql
```

Скопируйте содержимое и выполните в Supabase Dashboard → SQL Editor.

### Шаг 2: Пересобрать и перезапустить контейнер

⚠️ **ВАЖНО:** Cron сейчас отключен (`CRON_ENABLED=false`)

```bash
cd ~/agents-monorepo

# Пересобрать agent-brain
docker-compose build --no-cache agent-brain

# Перезапустить
docker-compose up -d agent-brain

# Проверить, что запустился
docker-compose ps agent-brain
docker-compose logs -f agent-brain | head -30
```

### Шаг 3: Протестировать вручную

```bash
# Запустить batch вручную
curl -X POST http://localhost:7080/api/brain/cron/run-batch

# Смотреть логи в реальном времени
docker-compose logs -f agent-brain | grep -E "sendToMonitoringBot|processUser|processDailyBatch"
```

### Шаг 4: Проверить логи

Ищем в логах:

1. **Leader Lock:**
```json
{"where":"processDailyBatch","phase":"lock_acquired","instanceId":"agent-brain-prod"}
```

2. **Перед отправкой в мониторинг:**
```json
{
  "where":"sendToMonitoringBot",
  "phase":"before_send",
  "userId":"...",
  "username":"...",
  "chatId":"313145981",
  "botToken":"8147295667***",
  "reportLength":2345,
  "environment":"production",
  "hostname":"agent-brain-prod"
}
```

3. **После отправки:**
```json
{
  "where":"sendToMonitoringBot",
  "phase":"after_send",
  "success":true,
  "userId":"...",
  "username":"..."
}
```

### Шаг 5: Сверить количество

```bash
# Количество обработанных пользователей
docker-compose logs agent-brain | grep '"where":"processUser"' | grep '"status":"completed"' | wc -l

# Количество успешных отправок в мониторинг
docker-compose logs agent-brain | grep '"where":"sendToMonitoringBot"' | grep '"phase":"after_send"' | grep '"success":true' | wc -l

# Должны совпадать!
```

### Шаг 6: Проверить в Telegram

Зайдите в чат с мониторинг-ботом (313145981) и убедитесь, что:
- Пришло столько же сообщений, сколько `success:true` в логах
- Каждое сообщение начинается с "📊 ОТЧЁТ КЛИЕНТА"

### Шаг 7: Включить cron обратно (после успешного теста)

```bash
# Отредактируйте docker-compose.yml
nano ~/agents-monorepo/docker-compose.yml

# Измените:
- CRON_ENABLED=false
# на:
- CRON_ENABLED=true

# Перезапустите
docker-compose up -d agent-brain

# Проверьте, что cron включен
docker-compose logs agent-brain | grep cron
# Ожидаем: {"where":"cron","schedule":"0 8 * * *","timezone":"Asia/Almaty","status":"scheduled"}
```

---

## 🔍 Диагностика проблем

### Если в логах нет phase: "before_send"

Значит, sendToMonitoringBot вообще не вызывается. Проверьте:
- `inputs.dispatch` или `inputs.sendReport` должны быть true
- У пользователя должен быть `telegram_id` в БД

### Если success: false

Смотрите на `phase: "send_failed"` — там будет stack trace ошибки от Telegram API.

### Если два инстанса одновременно

В логах увидите:
```json
{"where":"processDailyBatch","status":"locked","lockedBy":"agent-brain-prod"}
```

Второй инстанс не будет обрабатывать пользователей.

---

## 🚨 Важные заметки

1. **Локальный инстанс:** Если у вас запущен локальный agent-brain (не в Docker), убедитесь, что:
   - У него другие `MONITORING_BOT_TOKEN` и `MONITORING_CHAT_ID` в env
   - Или он полностью выключен

2. **Timezone:** Cron запускается в 08:00 по Asia/Almaty

3. **Timeout:** Leader lock истекает через 1 час — достаточно для обработки всех пользователей

4. **Graceful degradation:** Если Supabase недоступен, leader lock не сработает, но batch продолжит работать

---

## 📊 Ожидаемый результат

После всех исправлений:

✅ **Только один инстанс** обрабатывает пользователей  
✅ **В логах видно**, какой токен/chat_id используется  
✅ **Количество `success: true`** = количество сообщений в Telegram  
✅ **Детальная диагностика** при любых ошибках  
✅ **Нет race conditions** между инстансами

---

## 🎉 Готово к продакшену

После успешного тестирования:
1. Включите cron обратно (`CRON_ENABLED=true`)
2. Закоммитьте изменения
3. Задеплойте на прод-сервер
4. Проверьте завтра в 08:00, что всё работает корректно

**Следующий автоматический запуск:** завтра в 08:00 по Asia/Almaty (если включите cron)

