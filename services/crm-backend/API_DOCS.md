# CRM API Documentation

## Авторизация

Все запросы (кроме `/auth/login` и `/public/*`) требуют авторизацию.

```
Authorization: Bearer crm_<your_api_key>
```

API ключ автоматически привязывается к `user_account_id` владельца и даёт полный доступ ко всем эндпоинтам от имени этого пользователя.

**Base URL:** `https://<domain>/api/crm`

---

## Аутентификация

### POST /auth/login
Логин (для браузера, агенту не нужен при использовании API ключа).

**Body:**
```json
{ "username": "string", "password": "string" }
```

**Response:**
```json
{
  "id": "uuid",
  "username": "string",
  "role": "admin | consultant",
  "is_tech_admin": false,
  "consultantId": "uuid | null",
  "consultantName": "string | null"
}
```

---

## Лиды (Диалоги)

### GET /dialogs/analysis
Получить список лидов с фильтрами.

**Query:**
| Параметр | Тип | Описание |
|----------|-----|----------|
| userAccountId | uuid | **Обязательный** |
| instanceName | string | Фильтр по WhatsApp инстансу |
| interestLevel | string | hot / warm / cold |
| minScore | number | Минимальный скор |
| funnelStage | string | Стадия воронки |
| qualificationComplete | boolean | Квалификация завершена |
| search | string | Поиск по имени/телефону |

### GET /dialogs/stats
Статистика по лидам.

**Query:** `userAccountId`

### GET /dialogs/export-csv
Экспорт лидов в CSV.

**Query:** `userAccountId`, `instanceName?`, `interestLevel?`

### POST /dialogs/analyze
Запустить анализ WhatsApp диалогов.

**Body:**
```json
{
  "userAccountId": "uuid",
  "instanceName": "string",
  "minIncoming": 1,
  "maxDialogs": 100,
  "maxContacts": 50
}
```

### POST /dialogs/leads
Создать лид вручную.

**Body:**
```json
{
  "phone": "string",
  "contactName": "string",
  "businessType": "string",
  "funnelStage": "string",
  "userAccountId": "uuid",
  "instanceName": "string",
  "notes": "string"
}
```

### PATCH /dialogs/leads/:id
Обновить лид.

**Body (все поля опциональны):**
```json
{
  "contactName": "string",
  "businessType": "string",
  "isOwner": "string",
  "funnelStage": "string",
  "interestLevel": "string",
  "score": 85,
  "notes": "string",
  "qualificationComplete": true
}
```

### DELETE /dialogs/analysis/:id
Удалить лид.

**Query:** `userAccountId`

### PATCH /dialogs/leads/:id/notes
Обновить заметки лида.

**Body:** `{ "notes": "string", "userAccountId": "uuid" }`

### PATCH /dialogs/leads/:id/autopilot
Вкл/выкл автопилот для лида.

**Body:** `{ "autopilotEnabled": true, "userAccountId": "uuid" }`

### POST /dialogs/leads/:id/generate-message
Сгенерировать AI-сообщение для лида.

**Body:** `{ "userAccountId": "uuid" }`

### POST /dialogs/leads/:id/send-message
Отправить сообщение лиду в WhatsApp.

**Body:** `{ "userAccountId": "uuid", "message": "string" }`

### POST /dialogs/reanalyze/:leadId
Переанализировать лид.

**Body:** `{ "userAccountId": "uuid" }`

### POST /dialogs/leads/:id/audio
Загрузить аудио (multipart). Транскрибирует через Whisper и переанализирует.

---

## Чаты

### GET /chats
Список чатов.

**Query:** `userAccountId`, `instanceName?`, `search?`, `limit?`, `offset?`

### GET /chats/:jid
Получить чат по JID.

**Query:** `userAccountId`, `instanceName`

### GET /chats/:jid/messages
Сообщения чата.

**Query:** `userAccountId`, `instanceName`, `limit?`, `offset?`

### POST /chats/:jid/messages
Отправить сообщение.

**Body:** `{ "userAccountId": "uuid", "instanceName": "string", "message": "string" }`

### POST /chats/:jid/toggle-bot
Вкл/выкл бота для чата.

**Body:** `{ "userAccountId": "uuid", "instanceName": "string", "enabled": true }`

---

## Консультанты

### GET /consultants
Список консультантов. **Auth required.**

### POST /consultants
Создать консультанта. **Admin only.**

**Body:**
```json
{
  "name": "string",
  "email": "string",
  "phone": "string",
  "specialization": "string",
  "createAccount": true
}
```

### PUT /consultants/:id
Обновить консультанта. **Admin only.**

### DELETE /consultants/:id
Удалить консультанта. **Admin only.**

### PUT /consultants/:id/schedules
Обновить расписание. **Admin only.**

**Body:**
```json
{
  "schedules": [
    { "day_of_week": 1, "start_time": "09:00", "end_time": "18:00", "is_active": true }
  ]
}
```

---

## Дашборд консультанта

Все эндпоинты требуют auth. Админ может передать `consultantId` для просмотра данных любого консультанта.

### GET /consultant/dashboard
Статистика дашборда.

**Query:** `period_type?` (week/month), `period_start?`, `consultantId?`

### GET /consultant/targets
Цели консультанта.

**Query:** `period_type?`, `period_start?`, `consultantId?`

### GET /consultant/leads
Лиды консультанта.

**Query:** `status?`, `is_booked?`, `consultantId?`, `limit`, `offset`

### PATCH /consultant/leads/:leadId/notes
Обновить заметки лида.

**Body:** `{ "notes": "string" }`

### GET /consultant/consultations
Консультации.

**Query:** `date?`, `status?`, `from_date?`, `to_date?`, `consultantId?`

### GET /consultant/schedule
Расписание.

### PUT /consultant/schedule
Обновить расписание.

**Body:** `{ "schedules": [...] }`

### GET /consultant/services
Услуги консультанта.

### PUT /consultant/services
Обновить услуги.

**Body:**
```json
{
  "services": [
    { "service_id": "uuid", "custom_price": 5000, "custom_duration": 60, "is_active": true }
  ]
}
```

### POST /consultant/call-log
Записать звонок.

**Body:**
```json
{
  "lead_id": "uuid",
  "result": "string",
  "notes": "string",
  "next_follow_up": "2025-01-15"
}
```

### GET /consultant/call-logs/:leadId
История звонков лида.

### GET /consultant/profile
Профиль.

### PUT /consultant/profile
Обновить профиль.

### POST /consultant/consultation/create
Создать консультацию.

**Body:**
```json
{
  "service_id": "uuid",
  "date": "2025-01-15",
  "start_time": "10:00",
  "end_time": "11:00",
  "lead_id": "uuid",
  "client_name": "string",
  "client_phone": "string",
  "notes": "string"
}
```

### PUT /consultant/consultation/:id
Обновить консультацию.

**Body:** `{ "status?": "string", "notes?": "string", "start_time?", "end_time?", "date?" }`

### PUT /consultant/change-password
Сменить пароль.

**Body:** `{ "current_password": "string", "new_password": "string" }`

### GET /consultant/unread-count
Кол-во непрочитанных лидов.

---

## Сообщения консультанта

### POST /consultant/send-message
Отправить сообщение лиду. **Auth required.**

**Body:** `{ "leadId": "uuid", "message": "string" }`

### GET /consultant/messages/:leadId
История сообщений с лидом.

### POST /consultant/release-lead/:leadId
Вернуть лид боту.

---

## Продажи

### GET /consultant/sales
Список продаж.

**Query:** `consultantId`, `date_from?`, `date_to?`, `search?`, `product_name?`, `limit`, `offset`

### POST /consultant/sales
Добавить продажу.

**Body:**
```json
{
  "lead_id": "uuid",
  "client_name": "string",
  "client_phone": "string",
  "amount": 10000,
  "product_name": "string",
  "sale_date": "2025-01-15",
  "comment": "string"
}
```
**Query:** `consultantId`

### PUT /consultant/sales/:saleId
Редактировать продажу.

### DELETE /consultant/sales/:saleId
Удалить продажу.

### GET /consultant/sales/stats
Статистика продаж.

**Query:** `consultantId`, `month?`, `year?`

### GET /consultant/sales/chart
Данные для графика.

**Query:** `consultantId`, `period?`, `date_from?`, `date_to?`

---

## Задачи

### GET /consultant/tasks
Список задач. **Auth required.**

**Query:** `consultantId?`, `status?`, `due_date_from?`, `due_date_to?`, `lead_id?`, `search?`

### POST /consultant/tasks
Создать задачу.

**Body:**
```json
{
  "title": "string",
  "description": "string",
  "due_date": "2025-01-15",
  "lead_id": "uuid",
  "consultantId": "uuid"
}
```

### PUT /consultant/tasks/:taskId
Обновить задачу.

**Body:** `{ "title?", "description?", "status?", "due_date?", "result_notes?" }`

### DELETE /consultant/tasks/:taskId
Удалить задачу.

---

## Консультации

### GET /consultations
Список консультаций.

**Query:** `userAccountId`, `consultant_id?`, `status?`, `from_date?`, `to_date?`, `limit?`, `offset?`

### POST /consultations
Создать консультацию.

**Body:**
```json
{
  "userAccountId": "uuid",
  "consultant_id": "uuid",
  "service_id": "uuid",
  "client_name": "string",
  "client_phone": "string",
  "date": "2025-01-15",
  "start_time": "10:00",
  "end_time": "11:00",
  "notes": "string"
}
```

### PATCH /consultations/:id
Обновить консультацию.

### DELETE /consultations/:id
Удалить/отменить.

### POST /consultations/:id/complete
Отметить завершённой.

### GET /consultations/slots
Доступные слоты.

**Query:** `userAccountId`, `consultant_id`, `date`, `service_id?`

---

## Услуги

### GET /consultation-services
Список услуг.

**Query:** `user_account_id`, `include_inactive?`

### POST /consultation-services
Создать услугу.

**Body:**
```json
{
  "user_account_id": "uuid",
  "name": "Консультация",
  "description": "string",
  "duration_minutes": 60,
  "price": 5000,
  "currency": "KZT",
  "color": "#3B82F6",
  "is_active": true,
  "sort_order": 0
}
```

### PATCH /consultation-services/:id
Обновить услугу.

### DELETE /consultation-services/:id
Удалить услугу. **Query:** `hard?` (hard delete или soft)

---

## Записи звонков

### POST /consultant/call-recordings/upload
Загрузить запись звонка (multipart). **Auth required.**

**Fields:** `file` (audio), `lead_id?`, `title?`, `duration_seconds?`, `recording_mode?`, `consultant_id?`

### GET /consultant/call-recordings
Список записей. **Query:** `limit`, `offset`, `lead_id?`, `consultantId?`

### GET /consultant/call-recordings/:id
Детали записи.

### PATCH /consultant/call-recordings/:id
Обновить метаданные.

### DELETE /consultant/call-recordings/:id
Удалить запись.

---

## Уведомления

### GET /consultation-notifications/settings
Настройки уведомлений.

**Query:** `userAccountId`

### PUT /consultation-notifications/settings
Обновить настройки.

### GET /consultation-notifications/templates
Шаблоны уведомлений.

### POST /consultation-notifications/templates
Создать шаблон.

**Body:**
```json
{
  "name": "string",
  "minutes_before": 30,
  "template": "Напоминаем о консультации...",
  "is_enabled": true
}
```

### GET /consultation-notifications/history/:consultationId
История уведомлений.

---

## Шаблоны сообщений

### GET /templates
**Query:** `userAccountId`, `templateType?` (selling/useful/reminder), `isActive?`

### POST /templates
**Body:** `{ "userAccountId": "uuid", "title": "string", "content": "string", "templateType": "selling" }`

### PUT /templates/:id
### DELETE /templates/:id

---

## Бизнес-профиль

### GET /business-profile/:userId
Получить профиль бизнеса.

### POST /business-profile
Создать/обновить профиль.

**Body:**
```json
{
  "userAccountId": "uuid",
  "business_industry": "string",
  "business_description": "string",
  "target_audience": "string"
}
```

---

## Настройки кампании

### GET /campaign-settings/:userId
Получить настройки автопилота.

### PUT /campaign-settings/:userId
Обновить настройки.

**Body:**
```json
{
  "autopilotEnabled": true,
  "dailyMessageLimit": 50,
  "hotIntervalDays": 1,
  "warmIntervalDays": 3,
  "coldIntervalDays": 7,
  "workHoursStart": 9,
  "workHoursEnd": 18,
  "workDays": [1, 2, 3, 4, 5]
}
```

---

## Контексты кампании

### GET /contexts
**Query:** `user_account_id`

### POST /contexts
**Body:**
```json
{
  "user_account_id": "uuid",
  "type": "promo | case | content | news",
  "title": "string",
  "content": "string",
  "goal": "string",
  "start_date": "2025-01-15",
  "end_date": "2025-02-15",
  "target_funnel_stages": ["awareness"],
  "target_interest_levels": ["hot"],
  "priority": 1,
  "is_active": true
}
```

### PUT /contexts/:id
### DELETE /contexts/:id

---

## Отчёты

### GET /conversation-reports
**Query:** `userAccountId`, `limit?`, `offset?`

### GET /conversation-reports/latest
**Query:** `userAccountId`

### GET /conversation-reports/stats
**Query:** `userAccountId`, `days?`

### GET /conversation-reports/:id
**Query:** `userAccountId`

---

## AI Bot конфигурации

### GET /ai-bots
Список ботов.

**Query:** `userAccountId`, `instanceName?`

### GET /ai-bots/:botId
Получить бота по ID.

**Response:**
```json
{
  "id": "uuid",
  "system_prompt": "string",
  "model": "string",
  "temperature": 0.7,
  "max_tokens": 500,
  "booking_behavior": {
    "auto_use_pushname": true,
    "pushname_fallback_timeout_sec": 300
  }
}
```

### POST /ai-bots
Создать бота.

### PUT /ai-bots/:botId
Обновить промпт и настройки.

**Body (все поля опциональны):**
```json
{
  "system_prompt": "string",
  "model": "string",
  "temperature": 0.7,
  "max_tokens": 500
}
```

### DELETE /ai-bots/:botId
Удалить бота.

### POST /ai-bots/:botId/duplicate
Дублировать бота.

### PATCH /ai-bots/:botId/toggle
Вкл/выкл бота.

### GET /ai-bots/:botId/functions
Список функций бота.

### POST /ai-bots/:botId/functions
Добавить функцию.

### PUT /ai-bots/:botId/functions/:functionId
Обновить функцию.

### DELETE /ai-bots/:botId/functions/:functionId
Удалить функцию.

### GET /ai-bots/:botId/linked-instances
Привязанные WhatsApp инстансы.

---

## Админ-операции

### PUT /admin/leads/:leadId/reassign
Переназначить лид. **Admin only.**

**Body:** `{ "newConsultantId": "uuid" }`

### GET /admin/consultants/stats
Статистика консультантов.

### PUT /admin/consultant-targets
Установить цели.

**Body:** `{ "consultant_id": "uuid", "period_type": "month", "period_start": "2025-01-01", ... }`

### GET /admin/leads/unassigned
Неназначенные лиды.

### PUT /admin/consultants/:consultantId/accepts-new-leads
Вкл/выкл приём лидов.

### PUT /admin/consultants/:consultantId/sales-plan
Установить план продаж. **Admin only.**

**Body:** `{ "month": 1, "year": 2025, "plan_amount": 500000 }`

### GET /admin/sales/all
Все продажи.

---

## Подписки (Tech Admin)

### GET /admin/subscriptions/active-users
Активные пользователи.

### POST /admin/subscriptions/users/:userAccountId/set
Установить подписку вручную.

### POST /admin/subscriptions/users/:userAccountId/deactivate
Деактивировать пользователя.

### GET /admin/subscriptions/user-search
Поиск пользователей. **Query:** `q?`, `limit`

---

## Публичное бронирование (без авторизации)

### GET /public/booking/:userAccountId/config
Конфигурация виджета.

### GET /public/booking/:userAccountId/slots
Доступные слоты.

**Query:** `consultant_id?`, `service_id?`, `date?`, `days_ahead?`, `timezone?`

### POST /public/booking
Создать бронирование.

**Body:**
```json
{
  "user_account_id": "uuid",
  "consultant_id": "uuid",
  "service_id": "uuid",
  "client_name": "string",
  "client_phone": "string",
  "date": "2025-01-15",
  "start_time": "10:00",
  "notes": "string"
}
```

### GET /public/booking/:userAccountId/consultant/:consultantId
Информация о консультанте с услугами.

---

## Health Check

### GET /health
```json
{ "ok": true, "service": "crm-backend" }
```
