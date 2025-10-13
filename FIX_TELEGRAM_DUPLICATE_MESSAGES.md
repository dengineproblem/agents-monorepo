# 🔧 ИСПРАВЛЕНИЕ ДУБЛИРОВАНИЯ СООБЩЕНИЙ В TELEGRAM

## 📅 Дата: 13 октября 2025

---

## 🐛 ПРОБЛЕМА

При срабатывании крона в 8 утра пользователь получал **ДВА одинаковых сообщения** в Telegram от одного и того же аккаунта.

---

## 🔍 ПРИЧИНА

**Дублирование отправки сообщений** в двух местах кода:

### 1. Первая отправка - внутри `/api/brain/run`
```javascript:2285:2296:services/agent-brain/src/server.js
if (shouldSendTelegram) {
  try {
    sent = await sendTelegram(ua.telegram_id, reportText, ua.telegram_bot_token);
    fastify.log.info({ where: 'telegram_send_result', success: sent });
  } catch (err) {
    fastify.log.error({ 
      where: 'telegram_send_error', 
      error: String(err?.message || err),
      stack: err?.stack 
    });
  }
}
```

### 2. Вторая отправка - в функции `processUser` (ДУБЛИКАТ!)
```javascript
// СТАРЫЙ КОД (УДАЛЁН):
if (result.reportText && user.telegram_id && user.telegram_bot_token) {
  telegramResult = await sendTelegramReport(
    user.telegram_id,
    user.telegram_bot_token,
    result.reportText
  );
}
```

### Последовательность событий:
1. **08:00** - срабатывает крон (`cron.schedule('0 8 * * *')`)
2. Вызывается `processDailyBatch()`
3. Для каждого активного пользователя вызывается `processUser(user)`
4. `processUser()` делает запрос к `/api/brain/run` с `dispatch: true`
5. ❌ **ПЕРВОЕ сообщение** отправляется внутри `/api/brain/run`
6. ❌ **ВТОРОЕ сообщение** отправлялось в `processUser` после получения ответа

---

## ✅ РЕШЕНИЕ

### Что исправлено:

1. **Убрана дублирующая отправка в `processUser`**
   - Сообщение теперь отправляется **только один раз** - внутри `/api/brain/run`
   - `processUser` теперь просто читает статус отправки из `result.telegramSent`

2. **Унифицирована отправка в блоке `no_spend_yesterday`**
   - Заменена устаревшая функция `sendTelegramReport` на единую `sendTelegram`
   - Теперь используется `ua.telegram_id` и `ua.telegram_bot_token` (из user_accounts)
   - Вместо устаревших `telegram_chat_id` и глобального `TELEGRAM_BOT_TOKEN`

---

## 📝 ИЗМЕНЕННЫЕ ФАЙЛЫ

### 1. `services/agent-brain/src/server.js`

#### Изменение 1: Убрана дублирующая отправка в `processUser`
```javascript
// БЫЛО:
const result = await response.json();

// Отправляем отчет в Telegram
let telegramResult = null;
if (result.reportText && user.telegram_id && user.telegram_bot_token) {
  telegramResult = await sendTelegramReport(
    user.telegram_id,
    user.telegram_bot_token,
    result.reportText
  );
}

return {
  ...
  telegramSent: telegramResult?.success || false
};

// СТАЛО:
const result = await response.json();

// Telegram уже отправлен внутри /api/brain/run, не дублируем отправку
// (telegramSent уже есть в result)

return {
  ...
  telegramSent: result.telegramSent || false
};
```

#### Изменение 2: Унифицирована отправка в блоке `no_spend_yesterday`
```javascript
// БЫЛО:
if (inputs?.dispatch && ua.telegram_chat_id && process.env.TELEGRAM_BOT_TOKEN) {
  await sendTelegramReport(ua.telegram_chat_id, process.env.TELEGRAM_BOT_TOKEN, reportText);
}

// СТАЛО:
const shouldSendTelegram = inputs?.sendReport !== undefined 
  ? inputs.sendReport 
  : (inputs?.dispatch === true);

if (shouldSendTelegram && ua.telegram_id) {
  telegramSent = await sendTelegram(ua.telegram_id, reportText, ua.telegram_bot_token);
}
```

---

## 🚀 КАК ЗАДЕПЛОИТЬ

### На локальной машине (MacOS):

```bash
# 1. Перейти в директорию проекта
cd /Users/anatolijstepanov/agents-monorepo

# 2. Коммит изменений
git add services/agent-brain/src/server.js
git commit -m "fix: remove duplicate Telegram messages in cron (send only once)"

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

# 4. Пересобрать и перезапустить сервисы
docker-compose down
docker-compose up -d --build

# 5. Проверить что все запустилось
docker-compose ps

# Должно быть 3 сервиса:
# - agents-monorepo-agent-brain-1 (7080) - с кроном
# - agents-monorepo-creative-analyzer-1 (7081)
# - agents-monorepo-agent-service-1 (8082)

# 6. Проверить логи
docker-compose logs -f agent-brain | grep "cron\|telegram"
```

---

## 🧪 КАК ПРОВЕРИТЬ

### 1. Проверка через логи (до следующего срабатывания крона)
```bash
# Смотрим логи agent-brain
docker-compose logs -f agent-brain

# При следующем срабатывании крона (08:00) должно быть:
# ✅ [cron] schedule: 0 8 * * *, status: triggered
# ✅ [processDailyBatch] status: started
# ✅ [processUser] userId: xxx, status: started
# ✅ [before_telegram_send] shouldSendTelegram: true
# ✅ [telegram_send_result] success: true
# ✅ [processUser] userId: xxx, status: completed, telegramSent: true
# ❌ НЕ ДОЛЖНО быть второго вызова sendTelegram для того же пользователя!
```

### 2. Ручной запуск batch для тестирования
```bash
# Вызвать batch вручную (не дожидаясь 08:00)
curl -X POST http://localhost:7080/api/brain/cron/run-batch

# Проверить логи
docker-compose logs agent-brain --tail 100

# Проверить в Telegram - должно прийти ОДНО сообщение
```

### 3. Проверка активных пользователей
```bash
# Посмотреть какие пользователи будут обработаны кроном
curl http://localhost:7080/api/brain/cron/check-users

# Должен вернуть список пользователей с:
# - is_active: true
# - optimization: 'agent2'
# - has_telegram: true
```

---

## 📊 ОЖИДАЕМЫЙ РЕЗУЛЬТАТ

После деплоя:
- ✅ Пользователь получает **ОДНО** сообщение в 08:00
- ✅ Логи показывают только **ОДНУ** отправку на пользователя
- ✅ `telegramSent: true` передаётся из `/api/brain/run` в `processUser`
- ✅ Нет дублирующих вызовов `sendTelegram` / `sendTelegramReport`

---

## 🎯 ИТОГ

**Проблема:** Дублирование отправки сообщений (2 сообщения вместо 1)

**Причина:** Сообщение отправлялось дважды:
1. Внутри `/api/brain/run` 
2. В функции `processUser` после вызова API

**Решение:** Убрана дублирующая отправка в `processUser`

**Результат:** Теперь сообщение отправляется **только один раз** 🎉

---

## 📌 ПРИМЕЧАНИЕ

Функция `sendTelegramReport` осталась в коде (не удалена), но больше не используется. Можно удалить в будущем для чистоты кода, но она не мешает работе.

Вся отправка Telegram теперь происходит через единую функцию `sendTelegram`, которая:
- Поддерживает длинные сообщения (разбивает на части по 3800 символов)
- Имеет таймаут 30 секунд
- Использует персональный `telegram_bot_token` пользователя из базы
- Детально логирует все ошибки

**Готово к деплою!** 🚀

