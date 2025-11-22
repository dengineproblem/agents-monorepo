# 🔧 Переподключение AmoCRM - Пошаговая инструкция

**Дата:** 8 ноября 2025  
**Пользователь:** `0f559eb0-53fa-4b6a-a51b-5d3e15e5864b`  
**Subdomain:** `performanteaiagency`

---

## 📝 Что было исправлено

В файле `amocrm-connect.html`:
- ✅ Добавлена передача `subdomain` в state
- ✅ По умолчанию используется `performanteaiagency`
- ✅ Формат state теперь: `userAccountId|subdomain` (base64)

---

## 🚀 Шаги для деплоя

### Шаг 1: Скопировать файл на сервер

```bash
# На локальной машине
cd ~/agents-monorepo
scp amocrm-connect.html root@app.performanteaiagency.com:/var/www/html/amocrm-connect.html
```

Или вручную:
1. Откройте файл `amocrm-connect.html` на локальной машине
2. Скопируйте содержимое
3. На сервере: `nano /var/www/html/amocrm-connect.html`
4. Вставьте содержимое и сохраните (Ctrl+X, Y, Enter)

---

### Шаг 2: Проверить/Применить миграцию 030

На сервере выполните:

```bash
# Подключитесь к серверу
ssh root@app.performanteaiagency.com

# Перейдите в директорию проекта
cd ~/agents-monorepo

# Проверьте, применена ли миграция
docker-compose exec postgres psql -U postgres -d postgres -c "
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'user_accounts' 
  AND column_name IN ('amocrm_client_id', 'amocrm_client_secret');
"
```

**Если вернулось 2 строки** - миграция уже применена ✅

**Если вернулось 0 строк** - применить миграцию:

```bash
docker-compose exec -T postgres psql -U postgres -d postgres < migrations/030_add_amocrm_client_credentials.sql
```

---

### Шаг 3: Отключить старое подключение AmoCRM

```bash
curl -X DELETE "https://app.performanteaiagency.com/api/amocrm/disconnect?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
```

**Ожидаемый ответ:**
```json
{"success":true}
```

---

### Шаг 4: Переподключить AmoCRM через кнопку

**Откройте в браузере:**

```
https://app.performanteaiagency.com/amocrm-connect.html?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b&subdomain=performanteaiagency
```

**Действия:**
1. Откроется страница с кнопкой "Подключить amoCRM"
2. Нажмите кнопку
3. В popup окне выберите аккаунт AmoCRM
4. Авторизуйтесь и нажмите "Разрешить"
5. Дождитесь сообщения "AmoCRM успешно подключен!"

---

### Шаг 5: Проверить подключение

```bash
curl "https://app.performanteaiagency.com/api/amocrm/status?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
```

**Ожидаемый ответ:**
```json
{
  "connected": true,
  "subdomain": "performanteaiagency",
  "tokenExpiresAt": "2026-02-06T12:34:44.312+00:00"
}
```

✅ Обратите внимание на дату - токен должен быть действителен ~90 дней!

---

### Шаг 6: Проверить сохраненные credentials в БД

На сервере:

```bash
docker-compose exec postgres psql -U postgres -d postgres -c "
SELECT 
    amocrm_subdomain,
    CASE WHEN amocrm_client_id IS NOT NULL THEN 'ЕСТЬ ✅' ELSE 'НЕТ ❌' END as client_id_status,
    CASE WHEN amocrm_client_secret IS NOT NULL THEN 'ЕСТЬ ✅' ELSE 'НЕТ ❌' END as client_secret_status,
    amocrm_token_expires_at
FROM user_accounts
WHERE id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';
"
```

**Должно быть:**
- `amocrm_subdomain`: `performanteaiagency`
- `client_id_status`: `ЕСТЬ ✅`
- `client_secret_status`: `ЕСТЬ ✅`
- `amocrm_token_expires_at`: дата в будущем (~90 дней от сегодня)

---

### Шаг 7: Синхронизировать воронки AmoCRM

```bash
curl -X POST "https://app.performanteaiagency.com/api/amocrm/sync-pipelines?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
```

**Ожидаемый ответ:**
```json
{
  "success": true,
  "synced": 15,
  "pipelines": 3
}
```

---

### Шаг 8: Проверить воронки

```bash
curl "https://app.performanteaiagency.com/api/amocrm/pipelines?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
```

Должен вернуть список воронок и этапов.

---

### Шаг 9: Создать тестовый лид

```bash
curl -X POST "https://app.performanteaiagency.com/api/leads" \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "name": "Тест после переподключения",
    "phone": "+79991234567",
    "utm_campaign": "test_reconnect",
    "utm_source": "manual_test"
  }'
```

**Проверьте в AmoCRM:**
Должна появиться новая сделка "Лид: test_reconnect"

---

## ✅ Чек-лист

- [ ] Файл `amocrm-connect.html` скопирован на сервер
- [ ] Миграция 030 применена
- [ ] Старое подключение отключено
- [ ] AmoCRM переподключен через кнопку
- [ ] Статус показывает `connected: true`
- [ ] В БД есть `client_id` и `client_secret`
- [ ] Воронки синхронизированы
- [ ] Тестовый лид создан и виден в AmoCRM

---

## 🔧 Устранение проблем

### Ошибка: "AmoCRM OAuth credentials not configured"

**Причина:** credentials не сохранились в БД

**Решение:**
1. Проверьте, что миграция 030 применена
2. Убедитесь, что используете правильную ссылку с `subdomain`
3. Проверьте логи: `docker-compose logs -f agent-service | grep amocrm`

### Кнопка не появляется на странице

**Причина:** Скрипт AmoCRM не загрузился

**Решение:**
1. Откройте консоль браузера (F12)
2. Проверьте ошибки загрузки
3. Убедитесь, что файл обновлен на сервере: `curl https://app.performanteaiagency.com/amocrm-connect.html | grep subdomain`

### Токен все равно не обновляется

**Причина:** Нет ни credentials в БД, ни в env

**Решение:**
1. Проверьте БД (Шаг 6)
2. Если в БД нет - переподключитесь через кнопку заново
3. Если проблема осталась - проверьте логи сервера

---

## 📚 Связанные документы

- [AMOCRM_INTEGRATION_SETUP.md](./AMOCRM_INTEGRATION_SETUP.md) - Полная настройка
- [AMOCRM_BUTTON_INTEGRATION.md](./AMOCRM_BUTTON_INTEGRATION.md) - Документация кнопки
- [AMOCRM_PIPELINE_QUALIFICATION_IMPLEMENTATION.md](./AMOCRM_PIPELINE_QUALIFICATION_IMPLEMENTATION.md) - Воронки и квалификация

---

**Автор:** AI Agent  
**Дата:** 8 ноября 2025






