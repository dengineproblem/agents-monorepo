# Интеграция Bitrix24 CRM

## Обзор

Интеграция с Bitrix24 CRM поддерживает два режима работы:
- **Legacy mode** — токены хранятся в `user_accounts` (один Bitrix24 на пользователя)
- **Multi-account mode** — токены хранятся в `ad_accounts` (несколько Bitrix24 для разных рекламных аккаунтов)

### Сравнение с AmoCRM

| Параметр | AmoCRM | Bitrix24 |
|----------|--------|----------|
| Лиды и сделки | Одна сущность | Раздельные сущности |
| Rate limit | 7 req/sec | 2 req/sec |
| Токен lifetime | 24 часа | 1 час |
| Поиск по телефону | Фильтр | `crm.duplicate.findbycomm` |
| Batch запросы | Нет | До 50 методов |

---

## Архитектура

### Структура файлов

```
services/agent-service/src/
├── adapters/
│   └── bitrix24.ts              # API адаптер с rate limiting (2 req/sec)
├── lib/
│   └── bitrix24Tokens.ts        # OAuth токены (legacy + multi-account)
└── routes/
    ├── bitrix24OAuth.ts         # OAuth flow + подключение
    ├── bitrix24Pipelines.ts     # Воронки, sync-leads, key stages
    └── bitrix24Webhooks.ts      # Обработка входящих вебхуков

services/frontend/src/
├── services/
│   └── bitrix24Api.ts           # API клиент
└── components/bitrix24/
    ├── index.ts
    ├── Bitrix24QualificationFieldModal.tsx
    ├── Bitrix24KeyStageSelector.tsx
    └── Bitrix24KeyStageSettings.tsx

migrations/
├── 102_add_bitrix24_integration.sql    # Основная миграция
├── 103_bitrix24_key_stages.sql         # Key stages в directions
└── 104_bitrix24_multi_account.sql      # Multi-account поддержка
```

### OAuth Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend  │────>│ /bitrix24/   │────>│  Bitrix24   │
│   Profile   │     │   connect    │     │   OAuth     │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                 │
                    ┌──────────────┐             │
                    │ /bitrix24/   │<────────────┘
                    │   callback   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Save tokens │──> user_accounts (legacy)
                    │  Register    │──> ad_accounts (multi-account)
                    │  webhooks    │
                    └──────────────┘
```

### Webhook Flow

```
┌─────────────┐     ┌──────────────────────────────┐     ┌─────────────┐
│  Bitrix24   │────>│ /webhooks/bitrix24           │────>│  Update     │
│   Events    │     │ ?user_id=X&account_id=Y      │     │  local DB   │
└─────────────┘     └──────────────────────────────┘     └─────────────┘

События:
- ONCRMLEADADD      - Новый лид
- ONCRMLEADUPDATE   - Обновление лида
- ONCRMLEADDELETE   - Удаление лида
- ONCRMDEALADD      - Новая сделка
- ONCRMDEALUPDATE   - Обновление сделки
- ONCRMDEALDELETE   - Удаление сделки
- ONCRMCONTACTADD   - Новый контакт
- ONCRMCONTACTUPDATE - Обновление контакта
```

### Sync-Leads Flow

```
POST /bitrix24/sync-leads
    │
    ├── STEP 1: Link unlinked leads by phone
    │   │
    │   ├── Get leads WHERE phone IS NOT NULL
    │   │               AND bitrix24_lead_id IS NULL
    │   │               AND bitrix24_deal_id IS NULL
    │   │
    │   ├── For entityType='lead' or 'both':
    │   │   └── findByPhone(phones, 'LEAD') -> link by bitrix24_lead_id
    │   │
    │   └── For entityType='deal' or 'both':
    │       └── findByPhone(phones, 'CONTACT')
    │           -> getContact -> getDeals -> link by bitrix24_deal_id
    │
    └── STEP 2: Update status for linked leads
        │
        ├── Get leads WHERE bitrix24_lead_id IS NOT NULL
        │   └── getLeads(batch) -> update current_status_id
        │
        └── Get leads WHERE bitrix24_deal_id IS NOT NULL
            └── getDeals(batch) -> update current_status_id, current_pipeline_id
```

---

## База данных

### Миграции

| Файл | Описание |
|------|----------|
| `102_add_bitrix24_integration.sql` | Основные таблицы и колонки |
| `103_bitrix24_key_stages.sql` | Key stages в account_directions |
| `104_bitrix24_multi_account.sql` | Bitrix24 колонки в ad_accounts |

### Таблица user_accounts (Legacy mode)

```sql
-- Bitrix24 OAuth токены
bitrix24_domain              TEXT      -- example.bitrix24.ru
bitrix24_access_token        TEXT      -- OAuth access token
bitrix24_refresh_token       TEXT      -- OAuth refresh token
bitrix24_token_expires_at    TIMESTAMP -- Истекает через 1 час
bitrix24_member_id           TEXT      -- ID портала
bitrix24_user_id             INTEGER   -- ID пользователя Bitrix24
bitrix24_entity_type         TEXT      -- 'lead', 'deal', 'both'
bitrix24_qualification_fields JSONB    -- Поля квалификации (max 3)
bitrix24_connected_at        TIMESTAMP -- Время подключения
```

### Таблица ad_accounts (Multi-account mode)

```sql
-- Те же колонки что и в user_accounts
bitrix24_domain              TEXT
bitrix24_access_token        TEXT
bitrix24_refresh_token       TEXT
bitrix24_token_expires_at    TIMESTAMP
bitrix24_member_id           TEXT
bitrix24_user_id             INTEGER
bitrix24_entity_type         TEXT
bitrix24_connected_at        TIMESTAMP
```

### Таблица leads

```sql
bitrix24_lead_id             INTEGER   -- ID лида в Bitrix24
bitrix24_contact_id          INTEGER   -- ID контакта в Bitrix24
bitrix24_deal_id             INTEGER   -- ID сделки в Bitrix24
bitrix24_entity_type         TEXT      -- 'lead' или 'deal'
```

### Таблица account_directions (Key Stages)

```sql
-- Ключевые этапы для трекинга воронки
bitrix24_key_stage_1_category_id  INTEGER  -- ID воронки (0 для лидов)
bitrix24_key_stage_1_status_id    TEXT     -- STATUS_ID или STAGE_ID
bitrix24_key_stage_2_category_id  INTEGER
bitrix24_key_stage_2_status_id    TEXT
bitrix24_key_stage_3_category_id  INTEGER
bitrix24_key_stage_3_status_id    TEXT
```

### Новые таблицы

| Таблица | Описание |
|---------|----------|
| `bitrix24_pipeline_stages` | Воронки и этапы (category_id + status_id) |
| `bitrix24_status_history` | История изменений статусов |
| `bitrix24_sync_log` | Лог синхронизации и вебхуков |

---

## API Endpoints

Все endpoints поддерживают параметр `accountId` для multi-account mode.

### OAuth и подключение

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/bitrix24/connect` | GET | HTML страница подключения |
| `/bitrix24/auth` | GET | Редирект на OAuth Bitrix24 |
| `/bitrix24/callback` | GET | OAuth callback (сохраняет токены, регистрирует webhooks) |
| `/bitrix24/status` | GET | Статус подключения |
| `/bitrix24/disconnect` | DELETE | Отключить Bitrix24 |
| `/bitrix24/entity-type` | POST | Выбор типа сущностей (lead/deal/both) |

### Воронки и этапы

| Endpoint | Метод | Body | Описание |
|----------|-------|------|----------|
| `/bitrix24/sync-pipelines` | POST | `{userAccountId, accountId?}` | Синхронизация воронок из Bitrix24 |
| `/bitrix24/pipelines` | GET | query: `userAccountId, accountId?` | Получить все воронки |
| `/bitrix24/pipeline-stages/:id` | PATCH | `{userAccountId, accountId?, isQualifiedStage?, isSuccessStage?, isFailStage?}` | Обновить флаги этапа |

### Кастомные поля

| Endpoint | Метод | Body | Описание |
|----------|-------|------|----------|
| `/bitrix24/lead-custom-fields` | GET | query: `userAccountId, accountId?` | Поля лидов |
| `/bitrix24/deal-custom-fields` | GET | query: `userAccountId, accountId?` | Поля сделок |
| `/bitrix24/contact-custom-fields` | GET | query: `userAccountId, accountId?` | Поля контактов |
| `/bitrix24/qualification-fields` | GET | query: `userAccountId, accountId?` | Текущие поля квалификации |
| `/bitrix24/qualification-fields` | PATCH | `{userAccountId, accountId?, fields[]}` | Установить поля квалификации (max 3) |

### Синхронизация лидов

| Endpoint | Метод | Body | Описание |
|----------|-------|------|----------|
| `/bitrix24/sync-leads` | POST | `{userAccountId, accountId?, entityType?}` | Синхронизация лидов/сделок по телефону |

**Response:**
```json
{
  "success": true,
  "linked": 117,    // Новые связи созданы
  "updated": 117,   // Существующие связи обновлены
  "errors": 240     // Ошибки (телефон не найден или API error)
}
```

### Ключевые этапы (Key Stages)

| Endpoint | Метод | Body | Описание |
|----------|-------|------|----------|
| `/bitrix24/directions/:id/key-stages` | PATCH | `{userAccountId, accountId?, entityType, keyStages[]}` | Установить ключевые этапы |
| `/bitrix24/directions/:id/key-stage-stats` | GET | query: `userAccountId, dateFrom?, dateTo?` | Статистика по ключевым этапам |
| `/bitrix24/recalculate-key-stage-stats` | POST | `{userAccountId, accountId?, directionId?}` | Пересчёт статистики |

**keyStages format:**
```json
[
  {"categoryId": 0, "statusId": "NEW"},           // Этап 1
  {"categoryId": 0, "statusId": "IN_PROCESS"},   // Этап 2
  {"categoryId": 0, "statusId": "CONVERTED"}     // Этап 3
]
```

### Webhooks

| Endpoint | Метод | Query | Описание |
|----------|-------|-------|----------|
| `/webhooks/bitrix24` | POST | `user_id, account_id?` | Входящий webhook от Bitrix24 |

---

## Bitrix24 API Adapter

### Rate Limiting

Адаптер автоматически ограничивает запросы до 2 req/sec:

```typescript
// adapters/bitrix24.ts
const rateLimiter = new RateLimiter(2, 1000); // 2 requests per second
```

### Основные функции

| Функция | Описание |
|---------|----------|
| `getLeadStatuses()` | Статусы лидов |
| `getDealCategories()` | Воронки сделок с этапами |
| `getLeads(filter, select)` | Получить лиды с фильтром |
| `getDeals(filter, select)` | Получить сделки с фильтром |
| `getLead(id)` | Получить один лид |
| `getDeal(id)` | Получить одну сделку |
| `getContact(id)` | Получить контакт |
| `findByPhone(phones, entityType)` | Поиск по телефону через `crm.duplicate.findbycomm` |
| `extractPhone(entity)` | Извлечь телефон из сущности |
| `normalizePhone(phone)` | Нормализация телефона (только цифры) |
| `registerCRMWebhooks(domain, token, url, userId, entityTypes, accountId?)` | Регистрация вебхуков |

### Token Management

```typescript
// lib/bitrix24Tokens.ts

// Автоматически выбирает источник токенов
getValidBitrix24Token(userAccountId, accountId?)
// - Если accountId и multi_account_enabled → берёт из ad_accounts
// - Иначе → берёт из user_accounts
// - Автоматически refresh если токен истёк (lifetime = 1 час)
```

---

## Настройка

### 1. Создать OAuth приложение в Bitrix24

1. Войдите в портал Bitrix24
2. **Маркет → Разработчикам → Добавить локальное приложение**
   - Или: `https://YOUR_PORTAL.bitrix24.ru/devops/list/`

3. Заполните форму:
   - **Название**: Performante AI Agency
   - **Тип**: Серверное приложение
   - **Права доступа**: `crm`, `user`
   - **URL обработчика**: `https://app.performanteaiagency.com/api/bitrix24/callback`

4. Скопируйте `client_id` и `client_secret`

### 2. Переменные окружения

```bash
# .env.agent
BITRIX24_CLIENT_ID=your_client_id
BITRIX24_CLIENT_SECRET=your_client_secret
BITRIX24_REDIRECT_URI=https://app.performanteaiagency.com/api/bitrix24/callback
```

### 3. Применить миграции

```bash
# В Supabase SQL Editor выполнить по порядку:
migrations/102_add_bitrix24_integration.sql
migrations/103_bitrix24_key_stages.sql
migrations/104_bitrix24_multi_account.sql
```

### 4. Деплой

```bash
cd ~/agents-monorepo
git pull
docker compose up -d --build agent-service
```

---

## Чек-лист готовности

- [x] OAuth приложение создано в Bitrix24
- [x] Переменные окружения добавлены
- [x] Миграция 102 применена
- [x] Миграция 103 применена (key stages)
- [x] Миграция 104 применена (multi-account)
- [x] agent-service пересобран
- [x] Frontend пересобран
- [x] Тестовое подключение успешно
- [x] Webhooks получают события
- [x] sync-leads работает

---

## Troubleshooting

### Ошибка "Bitrix24 OAuth not configured on server"
Проверьте `BITRIX24_CLIENT_ID` и `BITRIX24_REDIRECT_URI` в `.env.agent`

### Ошибка при обмене кода на токен
`BITRIX24_CLIENT_SECRET` неверный или `BITRIX24_REDIRECT_URI` не совпадает с настройками в Bitrix24

### Webhooks не приходят
```bash
# Проверить логи
docker logs agents-monorepo-agent-service-1 2>&1 | grep -i bitrix24

# В Bitrix24: Маркет → Разработчикам → Ваше приложение → Исходящие вебхуки
```

### Rate limit ошибки
Адаптер автоматически ограничивает до 2 req/sec. При массовых операциях возможны задержки.

### Токен истёк (ERROR_OAUTH)
Токены автоматически обновляются. Если ошибка повторяется — переподключите Bitrix24.

### sync-leads показывает много ошибок
Ошибки означают что телефон не найден в Bitrix24 или API вернул ошибку. Проверьте логи:
```bash
docker logs agents-monorepo-agent-service-1 --since 5m 2>&1 | grep -i "linking\|error"
```

### Deal not found in Bitrix24
Это warning от webhook — сделка была удалена в CRM. Локальный лид отвязывается автоматически.

---

## Логирование

| Таблица | Что логируется |
|---------|----------------|
| `bitrix24_sync_log` | Все синхронизации и webhooks |
| `bitrix24_status_history` | Изменения статусов лидов/сделок |
| `error_logs` | Ошибки с типом `bitrix24` |

### Полезные запросы

```sql
-- Последние синхронизации
SELECT * FROM bitrix24_sync_log
WHERE user_account_id = 'UUID'
ORDER BY created_at DESC LIMIT 20;

-- История статусов лида
SELECT * FROM bitrix24_status_history
WHERE lead_id = 'UUID'
ORDER BY created_at DESC;

-- Ошибки Bitrix24
SELECT * FROM error_logs
WHERE error_type = 'bitrix24'
ORDER BY created_at DESC LIMIT 20;
```
