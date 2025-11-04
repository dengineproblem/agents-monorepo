# Исправление маршрутов AmoCRM - 404 Error Fix

**Дата:** 4 ноября 2025  
**Проблема:** AmoCRM OAuth endpoints возвращали 404 Not Found  
**Решение:** Удален дублирующийся префикс `/api/` из определений маршрутов

---

## 🔴 Проблема

При попытке инициировать OAuth flow AmoCRM через URL:
```
https://app.performanteaiagency.com/api/amocrm/auth?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b&subdomain=amo
```

Сервер возвращал:
```json
{
  "message": "Route GET:/amocrm/auth?userAccountId=... not found",
  "error": "Not Found",
  "statusCode": 404
}
```

### Причина

**Двойной префикс `/api/`:**

1. **Nginx конфигурация** (`nginx-production.conf`, строки 100-103 и 224-226):
   ```nginx
   location /api/ {
       rewrite ^/api/(.*)$ /$1 break;  # Убирает /api/
       proxy_pass http://agent-service:8082;
   }
   ```

2. **Маршруты в agent-service** были определены с префиксом `/api/`:
   ```typescript
   app.get('/api/amocrm/auth', ...)  // ❌ Неправильно
   ```

**Что происходило:**
1. Запрос: `https://app.performanteaiagency.com/api/amocrm/auth`
2. Nginx убирает `/api/` → проксирует на `http://agent-service:8082/amocrm/auth`
3. Agent-service ищет `/amocrm/auth`, но у него зарегистрирован `/api/amocrm/auth`
4. Результат: **404 Not Found**

---

## ✅ Решение

Удалён префикс `/api/` из всех AmoCRM и leads маршрутов, так как **nginx уже добавляет этот префикс**.

### Исправленные файлы

#### 1. `services/agent-service/src/routes/amocrmOAuth.ts`

Было:
```typescript
app.get('/api/amocrm/auth', ...)
app.get('/api/amocrm/callback', ...)
app.get('/api/amocrm/status', ...)
app.delete('/api/amocrm/disconnect', ...)
```

Стало:
```typescript
app.get('/amocrm/auth', ...)
app.get('/amocrm/callback', ...)
app.get('/amocrm/status', ...)
app.delete('/amocrm/disconnect', ...)
```

#### 2. `services/agent-service/src/routes/amocrmWebhooks.ts`

Было:
```typescript
app.post('/api/webhooks/amocrm', ...)
```

Стало:
```typescript
app.post('/webhooks/amocrm', ...)
```

#### 3. `services/agent-service/src/routes/amocrmSecrets.ts`

Было:
```typescript
app.post('/api/amocrm/secrets', ...)
```

Стало:
```typescript
app.post('/amocrm/secrets', ...)
```

#### 4. `services/agent-service/src/routes/leads.ts`

Было:
```typescript
app.post('/api/leads', ...)
app.get('/api/leads/:id', ...)
app.get('/api/leads', ...)
```

Стало:
```typescript
app.post('/leads', ...)
app.get('/leads/:id', ...)
app.get('/leads', ...)
```

---

## 📝 Как это работает теперь

### Внешний URL (для клиентов):
```
https://app.performanteaiagency.com/api/amocrm/auth
```

### Nginx обработка:
1. Получает запрос: `/api/amocrm/auth`
2. Удаляет `/api/` через rewrite: `/amocrm/auth`
3. Проксирует на: `http://agent-service:8082/amocrm/auth`

### Agent-service регистрация:
```typescript
app.get('/amocrm/auth', ...)  // ✅ Соответствует!
```

---

## 🚀 Деплой

### Локально (для тестирования):
```bash
cd services/agent-service
npm run build
npm start
```

### На сервере:
```bash
cd ~/agents-monorepo

# Подтянуть изменения
git pull origin main

# Пересобрать agent-service
docker-compose build agent-service

# Перезапустить контейнер
docker-compose up -d agent-service

# Проверить логи
docker-compose logs -f agent-service
```

---

## ✅ Проверка работы

### 1. Проверка доступности маршрута

```bash
curl -I "https://app.performanteaiagency.com/api/amocrm/auth?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b&subdomain=amo"
```

**Ожидаемый результат:** HTTP 302 (redirect на AmoCRM)

### 2. Полная проверка OAuth flow

```bash
# Откройте в браузере
https://app.performanteaiagency.com/api/amocrm/auth?userAccountId=YOUR_USER_ID&subdomain=amo
```

**Ожидаемое поведение:**
1. ✅ Редирект на страницу авторизации AmoCRM
2. ✅ После авторизации редирект обратно на `/api/amocrm/callback`
3. ✅ Отображается страница "AmoCRM подключен!"
4. ✅ Токены сохранены в БД

### 3. Проверка webhook endpoint

```bash
curl -X POST "https://app.performanteaiagency.com/api/webhooks/amocrm?user_id=YOUR_USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

**Ожидаемый результат:** HTTP 200 (webhook принят)

### 4. Проверка leads endpoint

```bash
curl -X POST "https://app.performanteaiagency.com/api/leads" \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "YOUR_USER_ID",
    "name": "Test Lead",
    "phone": "+79991234567"
  }'
```

**Ожидаемый результат:** HTTP 200 с `{ "success": true, "leadId": ... }`

---

## 📊 Затронутые endpoints

Все endpoints остаются доступны по тем же внешним URL:

| Метод | Внешний URL | Внутренний маршрут |
|-------|-------------|-------------------|
| GET | `/api/amocrm/auth` | `/amocrm/auth` |
| GET | `/api/amocrm/callback` | `/amocrm/callback` |
| GET | `/api/amocrm/status` | `/amocrm/status` |
| DELETE | `/api/amocrm/disconnect` | `/amocrm/disconnect` |
| POST | `/api/amocrm/secrets` | `/amocrm/secrets` |
| POST | `/api/webhooks/amocrm` | `/webhooks/amocrm` |
| POST | `/api/leads` | `/leads` |
| GET | `/api/leads/:id` | `/leads/:id` |
| GET | `/api/leads` | `/leads` |

---

## 🔍 Для будущего

### Правило для новых маршрутов:

**❌ НЕ делайте так:**
```typescript
app.get('/api/something', ...)  // Дублирование префикса!
```

**✅ Делайте так:**
```typescript
app.get('/something', ...)  // Nginx добавит /api/ автоматически
```

### Исключения:

Маршруты регистрируются БЕЗ префикса `/api/`, если:
- Они зарегистрированы без `prefix` в `server.ts`, И
- Nginx обрабатывает их через `location /api/`

Маршруты регистрируются С префиксом, если:
- Они доступны на отдельном домене (например, `agents.performanteaiagency.com`)
- Nginx проксирует всё напрямую (без rewrite)

### Примеры из существующих маршрутов:

**БЕЗ префикса (используют nginx /api/):**
```typescript
// server.ts
app.register(facebookWebhooks);  // БЕЗ prefix

// facebookWebhooks.ts
app.post('/facebook/oauth/token', ...)  // ✅ Правильно
```

**С префиксом (зарегистрированы с prefix):**
```typescript
// server.ts
app.register(videoRoutes, { prefix: '/api' });

// videoRoutes.ts
app.post('/video/upload', ...)  // Станет /api/video/upload
```

---

## 📚 Связанная документация

- [AMOCRM_INTEGRATION_SETUP.md](./AMOCRM_INTEGRATION_SETUP.md) - Полная настройка интеграции
- [AMOCRM_BUTTON_INTEGRATION.md](./AMOCRM_BUTTON_INTEGRATION.md) - Кнопка AmoCRM на сайте
- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) - Архитектура и nginx конфигурация

---

## ✅ Статус

- [x] Исправлены маршруты в amocrmOAuth.ts
- [x] Исправлены маршруты в amocrmWebhooks.ts
- [x] Исправлены маршруты в amocrmSecrets.ts
- [x] Исправлены маршруты в leads.ts
- [x] Создана документация
- [ ] Протестировано на сервере
- [ ] Проверен полный OAuth flow
- [ ] Обновлена документация AMOCRM_INTEGRATION_SETUP.md (если нужно)

---

## 🎉 Автоматическое создание интеграции (Вариант 2)

### Обновление от 4 ноября 2025

Добавлена поддержка **автоматического создания интеграции** через кнопку AmoCRM. Теперь не нужно вручную создавать интеграцию в AmoCRM!

### Как это работает:

#### 1. Пользователь открывает страницу подключения:
```
https://app.performanteaiagency.com/amocrm-connect.html?userAccountId=YOUR_USER_ID
```

#### 2. Нажимает кнопку "Подключить amoCRM"

#### 3. AmoCRM выполняет автоматическую последовательность:

**Шаг 1:** AmoCRM отправляет webhook на `/api/amocrm/secrets`:
```json
POST /api/amocrm/secrets
{
  "client_id": "auto-generated-id",
  "client_secret": "auto-generated-secret",
  "state": "base64-encoded-state",
  "name": "AI-таргетолог Performante",
  "scopes": "crm,notifications"
}
```
→ Сохраняется во временную таблицу `amocrm_oauth_temp_credentials` (expires in 10 min)

**Шаг 2:** Открывается окно авторизации AmoCRM

**Шаг 3:** Пользователь авторизуется

**Шаг 4:** AmoCRM редиректит на `/api/amocrm/callback`:
```
GET /api/amocrm/callback?code=XXX&state=YYY
```

**Шаг 5:** Backend:
- Получает `client_id` и `client_secret` из временного хранилища по `state`
- Обменивает `code` на токены используя эти credentials
- Сохраняет токены в `user_accounts`
- Удаляет временные credentials

✅ **Готово!** Интеграция создана и подключена автоматически!

### Новые файлы:

#### 1. **Миграция:** `migrations/023_amocrm_oauth_temp_credentials.sql`
```sql
CREATE TABLE amocrm_oauth_temp_credentials (
    id UUID PRIMARY KEY,
    state TEXT UNIQUE NOT NULL,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    user_account_id UUID,
    integration_name TEXT,
    scopes TEXT,
    expires_at TIMESTAMPTZ NOT NULL
);
```

#### 2. **Helper functions:** `services/agent-service/src/lib/amocrmTempCredentials.ts`
- `saveTempCredentials()` - сохранить credentials временно
- `getTempCredentials()` - получить credentials по state
- `deleteTempCredentials()` - удалить после успешного OAuth
- `extractUserAccountIdFromState()` - извлечь user_account_id из state

#### 3. **HTML страница:** `amocrm-connect.html`
- Красивая страница с кнопкой AmoCRM
- Автоматическая генерация `state` из URL параметра
- Обработка успешного подключения
- Редирект на профиль после подключения

### Обновленные файлы:

#### 1. **amocrmSecrets.ts:**
- Теперь сохраняет credentials во временную таблицу
- Извлекает `user_account_id` из state если он закодирован

#### 2. **amocrmOAuth.ts (callback):**
- Проверяет временное хранилище credentials
- Поддерживает оба варианта:
  - ✅ Автосоздание (credentials из temp storage)
  - ✅ Pre-configured (credentials из env)
- Удаляет временные credentials после успешного OAuth

#### 3. **adapters/amocrm.ts (exchangeCodeForToken):**
- Принимает опциональные `clientId` и `clientSecret`
- Fallback на env переменные если не переданы

### Использование:

**Для пользователей (рекомендуется):**
1. Откройте: `https://app.performanteaiagency.com/amocrm-connect.html?userAccountId=YOUR_ID`
2. Нажмите кнопку
3. Авторизуйтесь в AmoCRM
4. Готово! ✅

**Для разработчиков (legacy):**
1. Создайте интеграцию в AmoCRM вручную
2. Добавьте `AMOCRM_CLIENT_ID` и `AMOCRM_CLIENT_SECRET` в `.env.agent`
3. Используйте прямую ссылку: `/api/amocrm/auth`

### Безопасность:

- Временные credentials хранятся **только 10 минут**
- После успешного OAuth автоматически удаляются
- Функция `cleanup_expired_amocrm_oauth_credentials()` для периодической очистки
- State используется как one-time nonce

### Отладка:

```bash
# Проверить временные credentials
SELECT * FROM amocrm_oauth_temp_credentials;

# Очистить вручную
DELETE FROM amocrm_oauth_temp_credentials WHERE expires_at < NOW();

# Или вызвать функцию
SELECT cleanup_expired_amocrm_oauth_credentials();
```

---

**Автор:** AI Agent  
**Дата создания:** 4 ноября 2025  
**Последнее обновление:** 4 ноября 2025 (добавлена поддержка автосоздания интеграции)

