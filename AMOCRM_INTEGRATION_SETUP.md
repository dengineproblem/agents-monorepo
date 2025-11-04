# Настройка интеграции AmoCRM

Руководство по настройке и использованию интеграции AmoCRM для автоматической передачи лидов с сайта и получения данных о сделках.

## Содержание

1. [Обзор](#обзор)
2. [Требования](#требования)
3. [Настройка AmoCRM](#настройка-amocrm)
4. [Настройка сервера](#настройка-сервера)
5. [Подключение AmoCRM аккаунта](#подключение-amocrm-аккаунта)
6. [Отправка лидов с сайта](#отправка-лидов-с-сайта)
7. [Настройка webhooks](#настройка-webhooks)
8. [Проверка работы](#проверка-работы)
9. [Troubleshooting](#troubleshooting)

## Обзор

Интеграция AmoCRM позволяет:

- ✅ Автоматически передавать лиды с вашего сайта в AmoCRM
- ✅ Создавать контакты и сделки с UTM-метками
- ✅ Получать уведомления о закрытых сделках
- ✅ Связывать продажи с рекламными кампаниями для аналитики ROI

### Архитектура

```
Сайт → POST /api/leads → Supabase → AmoCRM API
                            ↓
                    UTM трекинг + Lead ID

AmoCRM (сделка закрыта) → Webhook → /api/webhooks/amocrm → Supabase
                                                              ↓
                                                      Таблица sales
```

## Требования

- ✅ Аккаунт AmoCRM (любой тариф)
- ✅ Права администратора в AmoCRM
- ✅ Доступ к настройкам вашего сервера
- ✅ Миграция базы данных 022 применена

## Настройка AmoCRM

### Шаг 1: Создание интеграции

1. Войдите в ваш AmoCRM аккаунт (например, `amo.amocrm.ru`)
2. Перейдите в **Настройки** → **Интеграции** → **Создать интеграцию**
3. Заполните форму:
   - **Название**: "Система лидов performanteaiagency"
   - **Redirect URI**: `https://app.performanteaiagency.com/api/amocrm/callback`
   - **Доступы**:
     - ✅ Contacts (Контакты)
     - ✅ Leads (Сделки)
     - ✅ Read (Чтение)
     - ✅ Write (Запись)

4. Сохраните интеграцию и скопируйте:
   - **Client ID**
   - **Client Secret**

### Шаг 2: Определение поддомена

Ваш поддомен - это часть URL до `.amocrm.ru`:
- Если ваш AmoCRM: `example.amocrm.ru` → поддомен: `example`
- Если ваш AmoCRM: `amo.performanteaiagency.com` → поддомен: `amo`

## Настройка сервера

### Шаг 1: Применение миграции БД

Выполните миграцию для создания необходимых таблиц:

```bash
# Подключитесь к вашей БД Supabase через SQL Editor
# или используйте psql:

psql -h ikywuvtavpnjlrjtalqi.supabase.co \
     -U postgres \
     -d postgres \
     -f migrations/022_add_amocrm_integration.sql
```

Миграция создаст:
- Поля для OAuth токенов в `user_accounts`
- UTM поля в таблице `leads`
- Таблицу `amocrm_sync_log` для логов синхронизации
- Поля для AmoCRM ID в таблице `sales`

### Шаг 2: Настройка переменных окружения

Откройте файл `.env.agent` и заполните:

```bash
# AmoCRM Integration Configuration
AMOCRM_CLIENT_ID=ваш_client_id_из_шага_1
AMOCRM_CLIENT_SECRET=ваш_client_secret_из_шага_1
AMOCRM_REDIRECT_URI=https://app.performanteaiagency.com/api/amocrm/callback
AMOCRM_WEBHOOK_SECRET=  # опционально, для валидации webhooks
```

### Шаг 3: Пересборка и перезапуск сервиса

```bash
cd services/agent-service
npm run build

# Если используете Docker:
docker-compose restart agent-service

# Или локально:
npm start
```

Проверьте логи на наличие ошибок:

```bash
docker-compose logs -f agent-service
```

## Подключение AmoCRM аккаунта

### Вариант 1: Через API (рекомендуется для разработки)

```bash
# Замените YOUR_USER_ACCOUNT_ID на UUID вашего пользователя из таблицы user_accounts
curl "https://app.performanteaiagency.com/api/amocrm/auth?userAccountId=YOUR_USER_ACCOUNT_ID&subdomain=amo"
```

Этот URL перенаправит вас на страницу авторизации AmoCRM.

### Вариант 2: Через Frontend (будет реализовано позже)

В настройках пользователя появится кнопка "Подключить AmoCRM".

### Процесс авторизации

1. Вы будете перенаправлены на страницу AmoCRM
2. Нажмите "Разрешить доступ"
3. Вы вернётесь на страницу успешного подключения
4. Токены автоматически сохранятся в БД

### Проверка подключения

```bash
curl "https://app.performanteaiagency.com/api/amocrm/status?userAccountId=YOUR_USER_ACCOUNT_ID"
```

Ответ:
```json
{
  "connected": true,
  "subdomain": "amo",
  "tokenExpiresAt": "2024-12-04T10:30:00Z"
}
```

## Отправка лидов с сайта

### Формат запроса

```javascript
// Пример JavaScript кода для формы на сайте
const form = document.getElementById('lead-form');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const leadData = {
    userAccountId: 'YOUR_USER_ACCOUNT_ID', // UUID пользователя
    name: document.getElementById('name').value,
    phone: document.getElementById('phone').value,

    // UTM параметры (если есть)
    utm_source: getUrlParameter('utm_source'),
    utm_medium: getUrlParameter('utm_medium'),
    utm_campaign: getUrlParameter('utm_campaign'),
    utm_term: getUrlParameter('utm_term'),
    utm_content: getUrlParameter('utm_content'),

    // Опционально
    email: document.getElementById('email').value,
    message: document.getElementById('message').value
  };

  const response = await fetch('https://app.performanteaiagency.com/api/leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(leadData)
  });

  const result = await response.json();

  if (result.success) {
    alert('Спасибо! Мы свяжемся с вами в ближайшее время.');
  }
});

function getUrlParameter(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name) || '';
}
```

### Пример curl запроса

```bash
curl -X POST https://app.performanteaiagency.com/api/leads \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "YOUR_USER_ACCOUNT_ID",
    "name": "Иван Иванов",
    "phone": "+7 912 345-67-89",
    "utm_source": "facebook",
    "utm_medium": "cpc",
    "utm_campaign": "spring_sale"
  }'
```

Ответ:
```json
{
  "success": true,
  "leadId": 12345,
  "message": "Lead received successfully"
}
```

### Что происходит после отправки

1. ✅ Лид сохраняется в таблицу `leads` в Supabase
2. ✅ Сервер немедленно отвечает клиенту (не ждёт AmoCRM)
3. ✅ В фоне происходит синхронизация с AmoCRM:
   - Поиск/создание контакта по телефону
   - Создание сделки с UTM-метками
   - Сохранение AmoCRM ID в БД

## Настройка webhooks

Webhooks позволяют получать уведомления, когда сделки закрываются в AmoCRM.

### Шаг 1: Настройка webhook в AmoCRM

1. В AmoCRM перейдите в **Настройки** → **Интеграции** → **Webhooks**
2. Создайте новый webhook:
   - **URL**: `https://app.performanteaiagency.com/api/webhooks/amocrm?user_id=YOUR_USER_ACCOUNT_ID`
   - **События**:
     - ✅ Добавление сделки
     - ✅ Изменение сделки
     - ✅ Изменение статуса сделки
   - **Метод**: POST

### Шаг 2: Проверка webhook

После настройки создайте тестовую сделку в AmoCRM и проверьте логи:

```bash
docker-compose logs -f agent-service | grep "AmoCRM webhook"
```

Вы должны увидеть:
```
AmoCRM webhook received
Processing new AmoCRM leads
Created sale from AmoCRM deal
```

## Проверка работы

### 1. Проверка подключения

```bash
curl "https://app.performanteaiagency.com/api/amocrm/status?userAccountId=YOUR_ID"
```

### 2. Отправка тестового лида

```bash
curl -X POST https://app.performanteaiagency.com/api/leads \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "YOUR_ID",
    "name": "Тест",
    "phone": "+79991234567",
    "utm_campaign": "test"
  }'
```

### 3. Проверка в AmoCRM

Зайдите в AmoCRM → Сделки → должна появиться новая сделка "Лид: test"

### 4. Проверка логов синхронизации

```sql
SELECT * FROM amocrm_sync_log
WHERE user_account_id = 'YOUR_ID'
ORDER BY created_at DESC
LIMIT 10;
```

## Troubleshooting

### Ошибка: "AmoCRM is not connected"

**Причина**: OAuth токены не сохранены

**Решение**:
1. Проверьте подключение: `GET /api/amocrm/status`
2. Переподключите AmoCRM: `GET /api/amocrm/auth`

### Ошибка: "Failed to refresh AmoCRM token"

**Причина**: Refresh token истёк или был отозван

**Решение**:
1. Отключите интеграцию: `DELETE /api/amocrm/disconnect?userAccountId=YOUR_ID`
2. Подключите заново: `GET /api/amocrm/auth`

### Лиды не создаются в AmoCRM

**Проверьте**:
1. Логи синхронизации в `amocrm_sync_log`
2. Правильность телефона (должен быть в формате +7...)
3. Ошибки в логах сервиса: `docker-compose logs agent-service`

### Webhook не работает

**Проверьте**:
1. URL webhook в настройках AmoCRM правильный
2. `user_id` в URL соответствует вашему UUID
3. Сетевая доступность: AmoCRM должен иметь доступ к вашему серверу
4. Логи webhook: `docker-compose logs agent-service | grep webhook`

### Как узнать свой userAccountId?

```sql
SELECT id, access_token FROM user_accounts LIMIT 1;
```

Или в логах при старте сервиса.

## API Endpoints

### OAuth

- `GET /api/amocrm/auth?userAccountId={uuid}&subdomain={subdomain}` - Начать OAuth авторизацию
- `GET /api/amocrm/callback` - OAuth callback (автоматический)
- `GET /api/amocrm/status?userAccountId={uuid}` - Статус подключения
- `DELETE /api/amocrm/disconnect?userAccountId={uuid}` - Отключить AmoCRM

### Leads

- `POST /api/leads` - Создать лид с сайта
- `GET /api/leads?userAccountId={uuid}` - Получить список лидов
- `GET /api/leads/:id?userAccountId={uuid}` - Получить лид по ID

### Webhooks

- `POST /api/webhooks/amocrm?user_id={uuid}` - Webhook от AmoCRM

## Структура данных

### Таблица leads

```sql
leads (
  id SERIAL PRIMARY KEY,
  user_account_id UUID,
  chat_id TEXT,  -- Телефон в формате WhatsApp
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  amocrm_lead_id BIGINT,     -- ID сделки в AmoCRM
  amocrm_contact_id BIGINT,  -- ID контакта в AmoCRM
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

### Таблица sales

```sql
sales (
  id UUID PRIMARY KEY,
  client_phone VARCHAR(20),
  client_name VARCHAR(255),
  amount DECIMAL(10,2),
  currency VARCHAR(3),
  status VARCHAR(50),  -- 'pending', 'confirmed', 'paid', etc.
  sale_date DATE,
  amocrm_deal_id BIGINT,      -- ID сделки в AmoCRM
  amocrm_pipeline_id INTEGER, -- ID воронки
  amocrm_status_id INTEGER,   -- ID статуса
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

### Таблица amocrm_sync_log

Хранит все операции синхронизации для отладки.

```sql
amocrm_sync_log (
  id UUID PRIMARY KEY,
  user_account_id UUID,
  lead_id INTEGER,
  amocrm_lead_id BIGINT,
  sync_type TEXT,      -- 'lead_to_amocrm', 'deal_from_amocrm'
  sync_status TEXT,    -- 'success', 'failed', 'pending'
  request_json JSONB,
  response_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ
)
```

## Дополнительно

### Rate Limiting

AmoCRM ограничивает API до 7 запросов в секунду. Адаптер автоматически контролирует частоту запросов.

### Автоматическое обновление токенов

Токены обновляются автоматически за 5 минут до истечения срока действия.

### Логирование

Все операции логируются в:
1. Логи сервиса (`docker-compose logs`)
2. Таблицу `amocrm_sync_log` в БД

### Поддержка

При возникновении проблем:
1. Проверьте логи: `docker-compose logs -f agent-service`
2. Проверьте `amocrm_sync_log` в БД
3. Создайте issue в репозитории
