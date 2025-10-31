# План тестирования системы логирования и мониторинга

Дата: 31 октября 2025

## 🎯 Цель тестирования

Проверить что все изменения работают корректно:
1. Новые msg коды появляются в логах
2. Supabase wrapper проверяет env при старте
3. Facebook таймауты работают
4. Grafana дашборд показывает ошибки
5. Telegram алерты приходят с эмодзи

---

## ✅ Пре-чеклист (проверить перед тестированием)

- [ ] Код закоммичен в git
- [ ] Все сервисы пересобраны: `docker-compose build`
- [ ] Сервисы перезапущены: `docker-compose up -d`
- [ ] Grafana перезапущена: `docker-compose restart grafana promtail`
- [ ] Нет ошибок линтера (уже проверено ✅)

---

## 🧪 ТЕСТ 1: Supabase wrapper - проверка env при старте

### Цель
Убедиться что сервис не запускается без Supabase credentials

### Шаги

**1.1. Тест agent-brain:**
```bash
# Остановить agent-brain
docker-compose stop agent-brain

# Временно переименовать .env.brain
mv .env.brain .env.brain.bak

# Попытаться запустить (должен упасть)
docker-compose up agent-brain

# Ожидаемый результат:
# ❌ Сервис должен упасть с ошибкой
# Лог должен содержать: msg="supabase_config_missing"
# Exit code: 1
```

**1.2. Восстановить env:**
```bash
# Ctrl+C
docker-compose stop agent-brain
mv .env.brain.bak .env.brain
docker-compose up -d agent-brain
```

**1.3. Проверить что запустился:**
```bash
curl http://localhost:7080/api/brain/llm-ping
# Ожидается: {"ok":true,...}
```

### ✅ Критерий успеха
- Без env → сервис падает с `supabase_config_missing`
- С env → сервис запускается нормально

---

## 🧪 ТЕСТ 2: Facebook ошибки с msg кодами

### Цель
Проверить что ошибки Facebook логируются с правильными msg кодами

### Шаги

**2.1. Симуляция fb_token_expired:**

Вариант A (безопасный - в тестовом режиме):
```bash
# В коде временно добавить throw в facebook.ts:
# В функции graph() после строки 40 добавить:
if (path === 'me') {
  const err: any = new Error('Test error');
  err.fb = { status: 401, code: 190, error_subcode: 0 };
  const resolution = resolveFacebookError(err.fb);
  log.error({ msg: resolution.msgCode, meta: err.fb, resolution }, 'Test FB error');
  throw err;
}

# Пересобрать и перезапустить
docker-compose build agent-service
docker-compose restart agent-service

# Сделать запрос который вызовет ошибку
curl -X POST http://localhost:8082/api/test-endpoint
```

Вариант B (если есть тестовый токен):
```bash
# В .env.agent временно испортить токен
# Запустить действие требующее FB
# Проверить логи
```

**2.2. Проверить логи:**
```bash
docker-compose logs agent-service --tail 50 | grep '"msg":"fb_'

# Ожидается увидеть:
# "msg":"fb_token_expired"
# "resolution":{"msgCode":"fb_token_expired","short":"Сессия Facebook истекла...",...}
```

**2.3. Проверить в Grafana:**
1. Открыть Grafana → Explore
2. Запрос: `{service="agent-service",msg="fb_token_expired"} | json`
3. Должны увидеть лог с деталями

### ✅ Критерий успеха
- В логах появляется `"msg":"fb_token_expired"`
- В Grafana видно этот лог
- Поля `resolution.msgCode`, `resolution.short`, `resolution.hint` заполнены

---

## 🧪 ТЕСТ 3: Facebook таймауты

### Цель
Проверить что запросы к FB прерываются по таймауту

### Шаги

**3.1. Уменьшить таймаут для теста:**
```typescript
// В services/agent-service/src/adapters/facebook.ts
// Строка 38: изменить 15000 на 100
const timeout = setTimeout(() => controller.abort(), 100); // 100ms для теста
```

**3.2. Пересобрать:**
```bash
docker-compose build agent-service
docker-compose restart agent-service
```

**3.3. Сделать запрос к FB:**
```bash
# Любой endpoint который делает запрос к Facebook
# Запрос не успеет за 100ms → должен быть таймаут
```

**3.4. Проверить логи:**
```bash
docker-compose logs agent-service --tail 50 | grep 'fb_fetch_timeout'

# Ожидается:
# "msg":"fb_fetch_timeout"
# "timeout":100
```

**3.5. Вернуть нормальный таймаут:**
```typescript
// Вернуть 15000
const timeout = setTimeout(() => controller.abort(), 15000);
```

### ✅ Критерий успеха
- При таймауте появляется `msg="fb_fetch_timeout"`
- В логе указан `timeout: 100`

---

## 🧪 ТЕСТ 4: Grafana дашборд "Errors by User"

### Цель
Проверить что новый дашборд работает и показывает ошибки

### Шаги

**4.1. Открыть дашборд:**
1. Grafana → Dashboards → Browse
2. Найти "Errors by User"
3. Открыть

**4.2. Проверить переменные:**
- Dropdown `username` должен быть заполнен (если есть логи с userAccountName)
- Dropdown `service` должен показывать: agent-brain, agent-service, creative-analyzer, evolution-api
- Dropdown `msg` должен показывать типы ошибок

**4.3. Проверить панели:**

**Панель 1: "User Errors Log Stream"**
- Должны быть логи (если есть ошибки)
- Можно развернуть лог и увидеть детали JSON

**Панель 2: "Errors by Service (Last 24h)"**
- Должен быть bar chart с количеством ошибок
- Цвета: green < 10, yellow < 50, red >= 50

**Панель 3: "Errors by Message Type (Last 24h)"**
- Таблица с колонками: msg, service, Value
- **Важно:** В колонке msg должны быть эмодзи:
  - 🔑 Facebook токен истёк
  - ⏱️ Превышен лимит запросов FB
  - 🗄️ БД недоступна
  - и т.д.

**Панель 4: "Infrastructure Errors (no user)"**
- Логи без userAccountId
- Системные ошибки

**4.4. Тест фильтрации:**
1. Выбрать username = "All"
2. Выбрать service = "agent-service"
3. Выбрать msg = "fb_token_expired"
4. Должны показаться только эти ошибки

### ✅ Критерий успеха
- Дашборд отображается
- Все 4 панели работают
- Value mappings показывают эмодзи и русский текст
- Фильтры работают

---

## 🧪 ТЕСТ 5: Telegram алерты с эмодзи

### Цель
Проверить что алерты приходят в Telegram с правильным форматом

### Шаги

**5.1. Проверить env:**
```bash
# В .env.brain должны быть:
LOG_ALERT_TELEGRAM_BOT_TOKEN=...
LOG_ALERT_TELEGRAM_CHAT_ID=...
LOG_ALERT_POLL_INTERVAL_MS=30000
```

**5.2. Проверить что worker запущен:**
```bash
docker-compose logs agent-brain | grep 'Starting log alerts worker'

# Ожидается:
# "Starting log alerts worker"
```

**5.3. Сгенерировать тестовую ошибку:**
```bash
# Вариант 1: Испортить токен FB и сделать запрос
# Вариант 2: Остановить Supabase и попытаться сделать запрос к БД
# Вариант 3: Вручную залогировать ошибку в agent-brain:

# В коде agent-brain добавить:
fastify.log.error({
  msg: 'fb_token_expired',
  userAccountId: 'test-123',
  userAccountName: 'test-user',
  message: 'Test error for Telegram'
}, 'Test error');
```

**5.4. Подождать 30 секунд (POLL_INTERVAL_MS):**
```bash
# Worker должен подхватить ошибку и отправить в Telegram
```

**5.5. Проверить Telegram:**

Должно прийти сообщение в формате:
```
🔑 Facebook токен истёк
Тип: `fb_token_expired`
Сервис: agent-brain
Сообщение: Test error for Telegram
UserAccount: test-123
Имя: test-user
```

**5.6. Проверить логи worker:**
```bash
docker-compose logs agent-brain | grep 'Telegram alert sent'

# Ожидается:
# "module":"logAlertsWorker"
# "Telegram alert sent"
```

### ✅ Критерий успеха
- Алерт приходит в Telegram
- В сообщении есть эмодзи (🔑, ⏱️, 🗄️, ⚠️)
- Заголовок понятный на русском
- Есть поле "Тип" с msg кодом

---

## 🧪 ТЕСТ 6: Отчёты с ошибками FB

### Цель
Проверить что отчёты не показывают "Активен" если были ошибки FB

### Шаги

**6.1. Симуляция ошибки FB при запросе accountStatus:**
```bash
# В коде agent-brain в функции fetchAccountStatus временно добавить throw
# Или испортить токен

# Запустить /api/brain/run
curl -X POST http://localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{"userAccountId":"YOUR_USER_ID","inputs":{"dispatch":false}}'
```

**6.2. Проверить ответ:**
```json
{
  "reportText": "...",
  ...
}
```

**6.3. Проверить reportText:**

В reportText должно быть:
```
*Отчёт за 2025-10-31*

Статус кабинета: ⚠️ Не удалось получить данные из Facebook (...)

Выполненные действия:
...
```

**НЕ должно быть:**
```
Статус кабинета: Аккаунт активен
```

### ✅ Критерий успеха
- При ошибке FB статус = "⚠️ Не удалось получить данные..."
- При успехе статус = "Аккаунт активен" или "Аккаунт неактивен"

---

## 🧪 ТЕСТ 7: Cleanup script

### Цель
Проверить что скрипт очистки работает

### Шаги

**7.1. Проверить что скрипт executable:**
```bash
ls -l cleanup-docker.sh
# Должно быть: -rwxr-xr-x (x = executable)
```

**7.2. Запустить:**
```bash
./cleanup-docker.sh

# Ожидается:
# 🧹 Docker cleanup started: ...
# 📊 Disk usage BEFORE cleanup:
# 🗑️  Removing stopped containers...
# 🗑️  Removing dangling images...
# 🗑️  Removing unused images...
# ✅ Docker cleanup completed: ...
# 📊 Disk usage AFTER cleanup:
```

**7.3. Проверить что сработало:**
```bash
# Должен быть output с освобождённым местом
# Сравнить BEFORE и AFTER
```

### ✅ Критерий успеха
- Скрипт запускается без ошибок
- Показывает освобождённое место
- Не удаляет volumes (безопасно)

---

## 🧪 ТЕСТ 8: Интеграционный тест (E2E)

### Цель
Проверить всю цепочку: ошибка → лог → Loki → Grafana → Telegram

### Шаги

**8.1. Генерация реальной ошибки:**
```bash
# Вариант 1: Испортить Facebook токен в .env.agent
# Вариант 2: Выключить Supabase (если локальный)

# Сделать реальный запрос который вызовет ошибку
curl -X POST http://localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{"userAccountId":"REAL_USER_ID","inputs":{"dispatch":true}}'
```

**8.2. Проверить Docker logs:**
```bash
docker-compose logs agent-brain --tail 100 | grep '"level":"error"'

# Должна быть ошибка с msg кодом
```

**8.3. Проверить Loki:**
```bash
curl "http://localhost:3100/loki/api/v1/query?query={level=\"error\"}&limit=10"

# Должны увидеть ошибку в JSON
```

**8.4. Проверить Grafana:**
1. Открыть "Errors by User"
2. Должна появиться новая ошибка
3. В таблице должен быть msg с эмодзи

**8.5. Проверить Telegram (через 30 сек):**
- Должно прийти уведомление
- С эмодзи и понятным текстом

### ✅ Критерий успеха
- Ошибка прошла по всей цепочке
- В каждом звене видна с правильным форматом

---

## 📋 Чеклист после тестирования

После завершения всех тестов:

- [ ] Все тесты пройдены успешно
- [ ] Убраны тестовые изменения кода (если добавляли throw)
- [ ] Восстановлены env файлы
- [ ] Сервисы перезапущены с production конфигом
- [ ] Создан коммит с изменениями
- [ ] Обновлена документация (если нужно)

---

## 🐛 Если что-то не работает

### Проблема: Дашборд не появился в Grafana

**Решение:**
```bash
# Проверить что файл на месте
ls -l logging/grafana-provisioning/dashboards/errors-by-user.json

# Перезапустить Grafana
docker-compose restart grafana

# Подождать 10 секунд
sleep 10

# Обновить страницу Grafana
```

### Проблема: Value mappings не показывают эмодзи

**Решение:**
- Проверить JSON файл дашборда на правильность
- В Grafana открыть дашборд → Settings → JSON Model
- Проверить что есть секция "overrides" с mappings

### Проблема: Telegram алерты не приходят

**Решение:**
```bash
# Проверить env
docker-compose exec agent-brain env | grep LOG_ALERT

# Проверить логи worker
docker-compose logs agent-brain | grep logAlerts

# Проверить что Loki доступен
curl http://localhost:3100/ready
```

### Проблема: msg коды не появляются в логах

**Решение:**
```bash
# Проверить что код скомпилировался
docker-compose logs agent-service | grep "started"

# Пересобрать без кэша
docker-compose build --no-cache agent-service
docker-compose restart agent-service
```

---

## ✅ Финальный чеклист

После прохождения всех тестов убедитесь:

- [x] ✅ Нет ошибок линтера
- [ ] ✅ Supabase wrapper работает (падает без env)
- [ ] ✅ Facebook ошибки логируются с msg кодами
- [ ] ✅ Таймауты FB работают
- [ ] ✅ Grafana дашборд отображается
- [ ] ✅ Value mappings показывают эмодзи
- [ ] ✅ Telegram алерты приходят с правильным форматом
- [ ] ✅ Отчёты не показывают "Активен" при ошибках FB
- [ ] ✅ Cleanup script работает
- [ ] ✅ E2E тест прошёл успешно

---

## 📊 Отчёт о тестировании

После завершения заполните:

```
Дата: __________
Тестировал: __________

Результаты:
✅ Тест 1 (Supabase wrapper): ____
✅ Тест 2 (FB msg коды): ____
✅ Тест 3 (FB таймауты): ____
✅ Тест 4 (Grafana дашборд): ____
✅ Тест 5 (Telegram алерты): ____
✅ Тест 6 (Отчёты): ____
✅ Тест 7 (Cleanup script): ____
✅ Тест 8 (E2E): ____

Найденные проблемы:
1. ________
2. ________

Исправлено:
1. ________
2. ________

Статус: ☐ Все тесты пройдены  ☐ Есть проблемы
```

---

**Готово к тестированию!** 🚀
