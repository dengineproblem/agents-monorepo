# Facebook Lead Forms Integration

Документация по интеграции Facebook Lead Forms для сквозной аналитики.

## Обзор

Добавлена полная поддержка Facebook Lead Forms как нового типа кампании (objective) с возможностью:
- Создания кампаний/адсетов с целью Lead Forms
- Получения лидов через webhook в реальном времени
- Маппинга лидов с креативами для сквозной аналитики
- Отображения в ROI аналитике наравне с site_leads и whatsapp

## Архитектура

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        СОЗДАНИЕ КАМПАНИИ                                     │
└─────────────────────────────────────────────────────────────────────────────┘

1. Пользователь выбирает objective = 'lead_forms'
2. Выбирает Lead Form из списка (getLeadForms API)
3. Создаётся креатив с fb_creative_id_lead_forms
4. При запуске создаётся AdSet с:
   - optimization_goal: LEAD_GENERATION
   - destination_type: ON_AD
   - promoted_object: { page_id, lead_gen_form_id }

┌─────────────────────────────────────────────────────────────────────────────┐
│                        ПОЛУЧЕНИЕ ЛИДОВ                                       │
└─────────────────────────────────────────────────────────────────────────────┘

Facebook Lead Form → Webhook (POST /facebook/webhook)
                            ↓
                    leadgen_id, ad_id, form_id
                            ↓
              Lead Retrieval API (GET /{leadgen_id})
                            ↓
                    field_data (имя, телефон, email)
                            ↓
              resolveCreativeAndDirection(ad_id)
                            ↓
                ad_creative_mapping → creative_id, direction_id
                            ↓
              INSERT leads (source_type = 'lead_form')
                            ↓
                    ROI Analytics 📊
```

## Изменённые файлы

### Backend (agent-service)

#### Типы и настройки
| Файл | Изменения |
|------|-----------|
| `src/lib/defaultSettings.ts` | Добавлен `'lead_forms'` в `CampaignGoal` |
| `src/lib/settingsHelpers.ts` | Добавлен `'lead_forms'` в `CampaignObjective` |
| `src/routes/defaultSettings.ts` | Обновлена Zod схема для `lead_forms` |

#### Campaign Builder
| Файл | Изменения |
|------|-----------|
| `src/lib/campaignBuilder.ts` | `getOptimizationGoal`: lead_forms → LEAD_GENERATION |
| | `getBillingEvent`: lead_forms → IMPRESSIONS |
| | `createAdSetInCampaign`: destination_type = ON_AD |
| `src/routes/campaignBuilder.ts` | promoted_object с page_id + lead_gen_form_id |

#### Креативы
| Файл | Изменения |
|------|-----------|
| `src/routes/image.ts` | Создание image creative для lead_forms |
| `src/routes/video.ts` | Создание video creative для lead_forms |
| `src/routes/carouselCreative.ts` | Временная заглушка (не поддерживается) |
| `src/routes/actions.ts` | Выбор fb_creative_id_lead_forms |
| `src/adapters/facebook.ts` | `createLeadFormImageCreative()`, `createLeadFormVideoCreative()` |

#### Workflows
| Файл | Изменения |
|------|-----------|
| `src/workflows/createAdSetInDirection.ts` | Полная поддержка lead_forms objective |
| `src/workflows/createCampaignWithCreative.ts` | LeadForms в ObjectiveType |
| `src/workflows/creativeTest.ts` | Поддержка lead_forms в creative test |

#### Webhook для получения лидов
| Файл | Изменения |
|------|-----------|
| `src/routes/facebookWebhooks.ts` | **НОВОЕ**: GET/POST /facebook/webhook для leadgen |

### Agent Brain

| Файл | Изменения |
|------|-----------|
| `src/chatAssistant/agents/ads/handlers.js` | objectiveMap, creativeIdField, goalToObjective для lead_forms |
| `src/scoring.js` | Метрики для lead_forms objective |
| `src/chatAssistant/agents/creative/toolDefs.js` | lead_forms в допустимых objectives |
| `src/server.js` | formLeads в computeLeadsFromActions |

### Frontend

| Файл | Изменения |
|------|-----------|
| `src/context/AppContext.tsx` | `'lead_forms'` в DirectionObjective |
| `src/components/VideoUpload.tsx` | `'lead_forms'` в типах |
| `src/components/profile/EditDirectionDialog.tsx` | Валидация для lead_forms |
| `src/services/facebookApi.ts` | `getLeadForms()` API, action_type: 'lead' |

### Миграции

| Файл | Описание |
|------|----------|
| `migrations/102_add_lead_forms_objective.sql` | lead_form_id в default_ad_settings |
| `migrations/103_add_leadgen_id_to_leads.sql` | leadgen_id в leads |
| `migrations/104_add_fb_creative_id_lead_forms.sql` | fb_creative_id_lead_forms в user_creatives |
| `migrations/105_add_fb_page_access_token.sql` | fb_page_access_token в user_accounts и ad_accounts |

## Детали реализации

### 1. Webhook верификация (GET /facebook/webhook)

Facebook вызывает этот endpoint для верификации webhook subscription:

```typescript
// Запрос от Facebook
GET /facebook/webhook?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE

// Ответ (если токен совпадает)
200 OK: CHALLENGE
```

**Переменная окружения**: `FB_WEBHOOK_VERIFY_TOKEN` (default: `performante_leadgen_webhook_2024`)

### 2. Обработка leadgen событий (POST /facebook/webhook)

Facebook отправляет webhook когда пользователь заполняет форму:

```json
{
  "object": "page",
  "entry": [{
    "id": "PAGE_ID",
    "changes": [{
      "field": "leadgen",
      "value": {
        "leadgen_id": "111222333",
        "ad_id": "123456789",
        "form_id": "987654321",
        "page_id": "PAGE_ID",
        "adgroup_id": "ADSET_ID"
      }
    }]
  }]
}
```

### 3. Page Access Token

Для получения данных лида требуется **Page Access Token** (не User Access Token).

**Автоматическое получение:**
- При OAuth подключении (`/facebook/save-selection`) → получаем через `/me/accounts`
- При обновлении `fb_access_token` для ad_accounts → автоматически получаем Page Token
- Сохраняется в поле `fb_page_access_token` (user_accounts и ad_accounts)
- При создании направления с objective `lead_forms` backend:
  - требует `page_id` (user_accounts/ad_accounts),
  - пытается получить Page Access Token (сначала `/me/accounts`, затем fallback `/{page_id}?fields=access_token` — для system user токенов),
  - сохраняет `fb_page_access_token`,
  - подписывает страницу на `leadgen` (с повторной попыткой при неудаче).

**Логика в webhook:**
```typescript
// Приоритет: Page Access Token > User Access Token
const tokenForLeadData = pageAccessToken || userAccessToken;
const leadData = await retrieveLeadData(leadgen_id, tokenForLeadData);
```

**Подписка на leadgen события:**
```typescript
// Автоматически при сохранении OAuth данных
POST /{page_id}/subscribed_apps
  ?subscribed_fields=leadgen
  &access_token={page_access_token}
```

### 4. Lead Retrieval API

Получение данных лида по leadgen_id:

```typescript
GET https://graph.facebook.com/v20.0/{leadgen_id}
  ?fields=id,ad_id,form_id,created_time,field_data
  &access_token=PAGE_ACCESS_TOKEN

// Ответ
{
  "id": "111222333",
  "ad_id": "123456789",
  "form_id": "987654321",
  "field_data": [
    { "name": "full_name", "values": ["Иван Иванов"] },
    { "name": "phone_number", "values": ["+77001234567"] },
    { "name": "email", "values": ["ivan@example.com"] }
  ]
}
```

### 5. Маппинг с креативами

```
ad_id (из webhook) → ad_creative_mapping → creative_id + direction_id
```

Таблица `ad_creative_mapping` заполняется при создании объявлений через платформу.

### 6. Структура лида в БД

```sql
INSERT INTO leads (
  user_account_id,    -- UUID пользователя
  account_id,         -- UUID для мультиаккаунтности (из direction)
  name,               -- Имя из формы
  phone,              -- Телефон из формы
  email,              -- Email из формы
  source_type,        -- 'lead_form'
  source_id,          -- Facebook Ad ID
  creative_id,        -- UUID креатива (через ad_creative_mapping)
  direction_id,       -- UUID направления
  leadgen_id,         -- Facebook leadgen_id (для дедупликации)
  utm_source,         -- 'facebook_lead_form'
  utm_campaign        -- form_id
)
```

## Что нужно сделать для запуска

### 1. Применить миграции

```bash
# На production Supabase
psql -h YOUR_SUPABASE_HOST -U postgres -d postgres -f migrations/102_add_lead_forms_objective.sql
psql -h YOUR_SUPABASE_HOST -U postgres -d postgres -f migrations/103_add_leadgen_id_to_leads.sql
psql -h YOUR_SUPABASE_HOST -U postgres -d postgres -f migrations/104_add_fb_creative_id_lead_forms.sql
psql -h YOUR_SUPABASE_HOST -U postgres -d postgres -f migrations/105_add_fb_page_access_token.sql
```

Или через Supabase Dashboard → SQL Editor.

### 2. Настроить переменные окружения

```bash
# В .env или docker-compose
FB_WEBHOOK_VERIFY_TOKEN=performante_leadgen_webhook_2024  # Свой токен
FB_API_VERSION=v20.0
```

### 3. Настроить webhook в Facebook App

1. Перейти в [Facebook Developers](https://developers.facebook.com/) → Your App → Webhooks

2. Добавить новый webhook:
   - **Callback URL**: `https://performanteaiagency.com/api/facebook/webhook`
   - **Verify Token**: значение из `FB_WEBHOOK_VERIFY_TOKEN`

3. Подписаться на события:
   - Object: **Page**
   - Fields: **leadgen**

4. Для каждой Facebook Page пользователя:
   - Pages → Your Page → Settings → Webhooks
   - Подписать страницу на leadgen events приложения
   - При создании `lead_forms` направления подписка выполняется автоматически,
     но только если получен корректный Page Access Token.

### 4. Permissions в Facebook App

Убедиться что приложение имеет permissions:
- `pages_manage_ads` - для создания объявлений
- `leads_retrieval` - для получения данных лидов
- `pages_read_engagement` - для чтения данных страницы

### 5. Деплой

```bash
# Деплой agent-service
cd services/agent-service
npm run build
# Рестарт сервиса

# Деплой agent-brain (если есть изменения)
cd services/agent-brain
npm run build
# Рестарт сервиса

# Деплой frontend
cd services/frontend
npm run build
# Обновить static файлы
```

## Тестирование

### 1. Проверка webhook верификации

```bash
curl "https://performanteaiagency.com/api/facebook/webhook?hub.mode=subscribe&hub.verify_token=performante_leadgen_webhook_2024&hub.challenge=test123"
# Должен вернуть: test123
```

### 2. Симуляция leadgen события

```bash
curl -X POST https://performanteaiagency.com/api/facebook/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "page",
    "entry": [{
      "id": "YOUR_PAGE_ID",
      "changes": [{
        "field": "leadgen",
        "value": {
          "leadgen_id": "test123",
          "ad_id": "123456789",
          "form_id": "987654321",
          "page_id": "YOUR_PAGE_ID"
        }
      }]
    }]
  }'
```

### 3. Проверка через Facebook Test Tool

Facebook Developers → Webhooks → Test → leadgen

## Мониторинг

### Логи

```bash
# Просмотр логов webhook
grep "facebookWebhooks" /var/log/agent-service.log

# Успешные лиды
grep "Lead form lead created successfully" /var/log/agent-service.log

# Ошибки
grep "Failed to retrieve lead data" /var/log/agent-service.log

# Автоподписка lead_forms при создании направления
grep "Lead forms objective: ensuring page token and leadgen subscription" /var/log/agent-service.log
grep "Page subscribed to leadgen successfully" /var/log/agent-service.log
```

### SQL запросы

```sql
-- Лиды с лид-форм за сегодня
SELECT * FROM leads
WHERE source_type = 'lead_form'
AND created_at >= CURRENT_DATE
ORDER BY created_at DESC;

-- Статистика по source_type
SELECT source_type, COUNT(*)
FROM leads
GROUP BY source_type;

-- Лиды с маппингом на креативы
SELECT
  l.id,
  l.name,
  l.phone,
  l.leadgen_id,
  l.source_id as ad_id,
  c.title as creative_title,
  d.name as direction_name
FROM leads l
LEFT JOIN user_creatives c ON l.creative_id = c.id
LEFT JOIN account_directions d ON l.direction_id = d.id
WHERE l.source_type = 'lead_form'
ORDER BY l.created_at DESC
LIMIT 20;
```

## Troubleshooting

### Webhook не получает события

1. Проверить что webhook подписан на Page в Facebook App
2. Проверить что страница подписана на события приложения
3. Проверить логи nginx на 5xx ошибки
4. Проверить что endpoint доступен извне
5. Проверить логи `directionsRoutes` (автополучение Page Access Token и подписка leadgen)

### Лиды создаются без creative_id

1. Проверить что ad_creative_mapping заполнен для этого ad_id
2. Проверить что объявление создано через платформу (не вручную)
3. Запустить: `SELECT * FROM ad_creative_mapping WHERE ad_id = 'YOUR_AD_ID'`

### Ошибка "Failed to retrieve lead data"

1. Проверить что access_token пользователя валидный
2. Проверить что приложение имеет permission `leads_retrieval`
3. Проверить что Lead Form не архивирована
4. Проверить что `fb_page_access_token` актуален (при необходимости пересоздать lead_forms направление для автообновления)

### Дубликаты лидов

Система автоматически проверяет `leadgen_id` на уникальность. Если дубликаты появляются:
1. Проверить индекс: `SELECT * FROM pg_indexes WHERE indexname = 'idx_leads_leadgen_id_unique'`
2. Если индекса нет - применить миграцию 103

## Связанные документы

- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) - Деплой и инфраструктура
- [FRONTEND_API_CONVENTIONS.md](./FRONTEND_API_CONVENTIONS.md) - API конвенции
- [ROI_CALCULATOR.md](./ROI_CALCULATOR.md) - ROI аналитика (если есть)

## Changelog

### v1.2.0 (2026-01)
- Автополучение Page Access Token при создании направления с objective `lead_forms`
- Автоподписка страницы на `leadgen` (с повторной попыткой после обновления токена)
- Fallback получения Page Access Token через `/{page_id}?fields=access_token` (для system user токенов)
- Расширенное логирование в `directionsRoutes` и `facebookHelpers`

### v1.1.0 (2024-12)
- Добавлена поддержка Page Access Token для Lead Forms API
- Автоматическое получение и сохранение fb_page_access_token
- Автоматическая подписка страницы на leadgen события
- Миграции 104 (fb_creative_id_lead_forms) и 105 (fb_page_access_token)
- Вынесены общие Facebook функции в lib/facebookHelpers.ts

### v1.0.0 (2024-12)
- Добавлена поддержка lead_forms objective во всех workflows
- Реализован webhook для получения лидов из Facebook Lead Forms
- Добавлен маппинг лидов с креативами через ad_creative_mapping
- Миграции для lead_form_id и leadgen_id
