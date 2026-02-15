# Meta Conversions API (CAPI) Integration

Интеграция с Meta Conversions API для отправки событий конверсии из WhatsApp-диалогов и CRM.

## Обзор

Система отправляет события конверсии в Facebook для оптимизации рекламы. Поддерживается два источника данных:

1. **WhatsApp (LLM)** — автоматический анализ переписок с помощью GPT-4o-mini
2. **CRM (field/stage mapping)** — отслеживание изменений полей и этапов воронки в AMO CRM / Bitrix24

## Каналы CAPI и цели (objectives)

CAPI поддерживается для двух типов целей:

### 1. Цель "Конверсии" (`conversions`) — WhatsApp и Сайт

С миграции `200_conversions_objective.sql` цель `whatsapp_conversions` заменена на **`conversions`** с выбором канала:

```
objective = 'conversions'
  └── conversion_channel:
      ├── 'whatsapp'   → destination_type=WHATSAPP, capi_source: whatsapp|crm
      └── 'site'       → destination_type=WEBSITE,  capi_source: crm only
```

| Параметр | WhatsApp | Сайт |
|----------|----------|------|
| Campaign objective | `OUTCOME_SALES` | `OUTCOME_SALES` |
| AdSet optimization_goal | `OFFSITE_CONVERSIONS` | `OFFSITE_CONVERSIONS` |
| destination_type | `WHATSAPP` | `WEBSITE` |
| promoted_object | pixel_id + page_id + whatsapp_phone_number | pixel_id + custom_event_type |
| Creative | fb_creative_id_whatsapp | fb_creative_id_site_leads |
| CAPI source | whatsapp (AI) или crm | crm only |

### 2. Цель "Lead Forms" (`lead_forms`) — CRM CAPI оптимизация

Lead Forms используют отдельную цель `lead_forms` с опциональным CAPI toggle для CRM-оптимизации (Meta "Conversion Leads"):

```
objective = 'lead_forms'
  └── capi_enabled: true/false
      └── capi_source: 'crm' (единственный вариант)
```

| Параметр | Значение |
|----------|----------|
| Campaign objective | `OUTCOME_LEADS` |
| AdSet optimization_goal | `LEAD_GENERATION` |
| destination_type | `ON_AD` |
| promoted_object | `{ page_id }` (БЕЗ pixel_id) |
| Creative | fb_creative_id_lead_forms |
| CAPI source | crm only |

> **Важно:** Для Lead Forms `pixel_id` НЕ передаётся в `promoted_object`. Адсет настраивается как обычная лидформа. Оптимизация по CRM событиям происходит через CAPI события в датасет, матчинг по `leadgen_id`.

> **Ранее** Lead Form + CRM CAPI был реализован как `objective='conversions'` + `conversion_channel='lead_form'`. Сейчас это вынесено в отдельную цель `lead_forms` с CAPI toggle, т.к. на уровне Facebook API параметры кампании/адсета идентичны обычным лидформам.

### User matching по каналам

| Канал | Идентификаторы для матчинга |
|-------|---------------------------|
| **whatsapp** | phone (hashed), external_id, ctwa_clid (если доступен) |
| **lead_form** | leadgen_id (высший приоритет), phone (hashed), external_id |
| **site** | phone (hashed), external_id, fbclid/fbc/fbp (если настроен на сайте) |

### Обратная совместимость

- Существующие направления с `objective = 'whatsapp_conversions'` маппятся в `conversions` + `conversion_channel = 'whatsapp'`
- Legacy направления с `objective = 'conversions'` + `conversion_channel = 'lead_form'` продолжают работать (creative routes поддерживают оба варианта)
- `conversion_channel` обязателен для `conversions`, NULL для остальных

### События по уровням

Система отправляет **разные события в зависимости от канала и уровня**:

**WhatsApp (Messaging dataset)** — все уровни отправляют одно событие:

| Уровень | event_name | Условие |
|---------|------------|---------|
| 1 | `LeadSubmitted` | **Счётчик:** клиент с рекламы отправил 3+ сообщения |
| 2 | `LeadSubmitted` | **AI анализ:** ответил на квалификационные вопросы |
| 3 | `LeadSubmitted` | **AI анализ:** записался на ключевой этап |

**CRM dataset (Lead Forms, Сайт)** — разные события по уровням для качественной оптимизации Meta:

| Уровень | event_name | Описание |
|---------|------------|----------|
| 1 | `Contact` | Первый контакт / проявление интереса |
| 2 | `Schedule` | Квалифицирован / назначена встреча |
| 3 | `StartTrial` | Закрыт / начало использования |

```typescript
// metaCapiClient.ts
export const CRM_LEVEL_EVENTS: Record<number, string> = {
  1: 'Contact',     // L1
  2: 'Schedule',    // L2
  3: 'StartTrial',  // L3
};
```

**Фильтрация по уровню (`capi_event_level`):**
- `NULL` — отправлять на ВСЕХ уровнях (3 разных события)
- `1` — только Level 1 (Contact)
- `2` — только Level 2 (Schedule)
- `3` — только Level 3 (StartTrial)

> **Legacy:** Старые события `CompleteRegistration`, `AddToCart`/`Subscribe`, `Purchase` остаются в коде для обратной совместимости WhatsApp конверсий.

## Новая архитектура: CAPI Settings модуль (миграция 208+)

С миграции 208 настройки CAPI вынесены из `account_directions` в отдельную таблицу `capi_settings`. Одна конфигурация на канал (WhatsApp / Lead Forms / Сайт) на аккаунт.

### Таблица `capi_settings`

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_account_id | UUID FK | обязательно |
| account_id | UUID FK | NULL для legacy |
| channel | TEXT | `whatsapp`, `lead_forms`, `site` |
| pixel_id | TEXT | Pixel/Dataset ID |
| capi_access_token | TEXT | pixel-specific токен |
| capi_source | TEXT | `whatsapp` (AI) или `crm` |
| capi_crm_type | TEXT | `amocrm` или `bitrix24` |
| capi_interest_fields | JSONB | L1 CRM конфиг |
| capi_qualified_fields | JSONB | L2 CRM конфиг |
| capi_scheduled_fields | JSONB | L3 CRM конфиг |
| ai_l2_description | TEXT | описание L2 для AI |
| ai_l3_description | TEXT | описание L3 для AI |
| ai_generated_prompt | TEXT | сгенерированный промпт |
| is_active | BOOLEAN | soft delete |

UNIQUE constraint: `(user_account_id, account_id, channel)`

### Resolver pattern

Все потребители теперь используют единый resolver:

```typescript
// capiSettingsResolver.ts (есть в agent-service и chatbot-service)
resolveCapiSettingsForDirection(directionId) → ResolvedCapiSettings | null
```

Логика:
1. Загрузить direction → определить channel по `objective` + `conversion_channel`
2. Найти `capi_settings` по `(user_account_id, account_id, channel, is_active=true)`
3. **Fallback**: если не найдено → проверить legacy `account_directions.capi_enabled`

Channel resolution:
- `objective='conversions'` + `conversion_channel='whatsapp'` → `'whatsapp'`
- `objective='whatsapp_conversions'` → `'whatsapp'`
- `objective='conversions'` + `conversion_channel='lead_form'` → `'lead_forms'`
- `objective='conversions'` + `conversion_channel='site'` → `'site'`
- `objective='lead_forms'` → `'lead_forms'`

### API endpoints (agent-service)

```
GET    /api/capi-settings?userAccountId=...&accountId=...
GET    /api/capi-settings/:id
POST   /api/capi-settings          — создание (Zod-валидация)
PATCH  /api/capi-settings/:id      — обновление
DELETE /api/capi-settings/:id      — soft delete (is_active=false)
POST   /api/capi-settings/generate-prompt — генерация AI промпта
```

### UI: Meta CAPI в Подключениях

Настройка CAPI теперь через карточку "Meta CAPI" в ConnectionsGrid (Profile):
1. Клик → `CapiSettingsModal` (список каналов с edit/delete)
2. "Добавить канал" → `CapiWizard` (пошаговый визард)
   - Шаг 1: Выбор канала
   - Шаг 2: Источник (AI / CRM, только для WhatsApp)
   - Шаг 3: Pixel + Access Token
   - Шаг 4: Конфигурация (AI описания или CRM маппинги)

### Что осталось в направлениях

В `account_directions` осталось только `capi_event_level` (на каком уровне воронки отправлять событие). Все остальные CAPI-поля — legacy (для backward compatibility).

### Потребители resolver'а

| Файл | Функция | Что делает |
|------|---------|------------|
| `agent-service/src/lib/crmCapi.ts` | `getDirectionCapiSettings()` | CRM webhook → CAPI levels |
| `chatbot-service/src/lib/metaCapiClient.ts` | `getDirectionPixelInfo()` | Pixel + token для CAPI event |
| `chatbot-service/src/lib/qualificationAgent.ts` | `getDirectionCapiSettings()` | AI квалификация + CRM status |
| `chatbot-service/src/cron/capiAnalysisCron.ts` | `getDialogsForCapiAnalysis()` | Фильтрация WhatsApp CAPI |
| `chatbot-service/src/server.ts` | `POST /capi/crm-event` | CRM event source check |

---

## Архитектура

```
WhatsApp → Evolution API → agent-service → chatbot-service
                               │                 │
                               │                 ├── chatbotEngine (ответы бота)
                               │                 │
                               │                 └── qualificationAgent (Level 2, 3)
                               │                          │
                               │                    ┌─────┴─────┐
                               │                    │           │
                               │               LLM анализ   CRM check
                               │               (WhatsApp)   (field mapping)
                               │                    │           │
                               │                    └─────┬─────┘
                               │                          │
                               │                    metaCapiClient
                               │                          │
                               └──────────────────────────└── Meta CAPI

Level 1 (Interest) поток:
WhatsApp → Evolution API → agent-service
                               │
                               ├── handleAdLead() — если source_id в сообщении
                               │       └── Сброс capi_msg_count=0 (для повторных кликов)
                               │
                               └── upsertDialogAnalysis()
                                       │
                                       ├── isAdLead() = true? → capi_msg_count++
                                       │
                                       └── capi_msg_count >= 3? → POST /capi/interest-event
                                                                        │
                                                                        └── chatbot-service → Meta CAPI
```

### CRM Webhooks (для CRM источника)

```
AMO CRM / Bitrix24
        │
        └── Webhook при изменении сделки/лида
                │
                └── agent-service (bitrix24Webhooks.ts / amocrmWebhooks.ts)
                        │
                        ├── getDeal() — получить данные сделки из CRM API
                        │
                        ├── leads lookup по bitrix24_deal_id + user_account_id
                        │       (PGRST116 = нет matching лида — нормально для не-Facebook сделок)
                        │
                        ├── Обновление leads (current_status_id, current_pipeline_id)
                        │
                        └── syncDirectionCrmCapiForBitrixEntity()
                                │
                                ├── getDirectionCapiSettings(direction_id) → resolveCapiSettingsForDirection()
                                ├── evaluateBitrixCapiLevelsWithDiagnostics(entity, settings)
                                └── sendCrmCapiLevels() → chatbot-service /capi/crm-event → Meta CAPI
```

> **Важно:** Bitrix24 шлёт вебхуки для ВСЕХ сделок CRM, а не только для созданных через Facebook. Лид в нашей системе связывается с Bitrix-сделкой через `bitrix24_deal_id` (заполняется при push в Bitrix). Webhook body парсится через `qs.parse` (не `fast-querystring`) для поддержки вложенных объектов `data[FIELDS][ID]`.

## Компоненты

### 1. qualificationAgent.ts

Агент для определения уровня квалификации и отправки CAPI событий.

**Основные функции:**

- `analyzeQualification(dialog)` - анализирует диалог с помощью GPT-4o-mini
- `processDialogForCapi(dialog)` - отправляет CAPI события на основе анализа или CRM статуса
- `getDialogForCapi(instanceName, contactPhone)` - получает данные диалога для анализа
- `getDirectionCapiSettings(directionId)` - загружает настройки CAPI для направления
- `getCrmQualificationStatus(...)` - проверяет CRM поля для определения уровня

**Промпт квалификации (prompt2):**

Генерируется автоматически при онбординге на основе данных о бизнесе. Содержит:
- Контекст бизнеса
- 3-5 квалификационных вопросов
- Критерии "хорошего" vs "плохого" ответа
- Признаки записи на встречу

### 2. crmCapi.ts (agent-service)

Библиотека сопоставления CRM-триггеров с уровнями CAPI.

**Основные функции:**
- `getDirectionCapiSettings(directionId)` — читает direction-level конфиг
- `evaluateAmoCapiLevelsWithDiagnostics(...)` — матчинг для AmoCRM с детализацией
- `evaluateBitrixCapiLevelsWithDiagnostics(...)` — матчинг для Bitrix24 с детализацией
- `sendCrmCapiLevels(...)` — отправка уровней в chatbot-service (`/capi/crm-event`)
- `summarizeDirectionCapiSettings(...)` — агрегированный summary для логов

**Диагностика:**
- Определяет тип совпадения (`field` или `stage`)
- Логирует причину отсутствия совпадения (`reason`)
- Возвращает конфиг, который реально сработал (`matchedConfig`)

### 3. metaCapiClient.ts

Клиент для отправки событий в Meta Conversions API.

**Особенности:**
- Хеширование телефона (SHA256), email — опционально
- external_id для дедупликации и матчинга
- `ctwa_clid` в `user_data` (не top-level) — требование Messaging dataset
- `page_id` в `user_data` — обязателен для Messaging dataset (авто из ad_accounts/user_accounts)
- `country` hash в `user_data` — для лучшего матчинга
- action_source: `business_messaging` при наличии `ctwa_clid`, иначе fallback `system_generated`
- `messaging_channel: 'whatsapp'` — top-level параметр для business_messaging

**Типы событий:**

```typescript
// Константы базовых событий
const CAPI_EVENTS = {
  LEAD_SUBMITTED: 'LeadSubmitted',   // Messaging dataset (WhatsApp)
  LEAD: 'Lead',                      // Website/CRM dataset (legacy, единое событие)
  INTEREST: 'CompleteRegistration',   // Legacy Level 1
  QUALIFIED: 'AddToCart' | 'Subscribe', // Legacy Level 2 (configurable)
  SCHEDULED: 'Purchase',             // Legacy Level 3
};

// Per-level события для CRM dataset (lead_form, site)
const CRM_LEVEL_EVENTS = {
  1: 'Contact',     // L1: первый контакт
  2: 'Schedule',    // L2: квалифицирован
  3: 'StartTrial',  // L3: закрыт/оплата
};
```

- **WhatsApp** (Messaging dataset) → `LeadSubmitted` для всех уровней
- **CRM** (Lead Forms, Сайт) → per-level: `Contact` / `Schedule` / `StartTrial`

**Различия между LeadSubmitted и Lead:**

| Параметр | LeadSubmitted (Messaging) | Lead (Website) |
|----------|:-------------------------:|:--------------:|
| messaging_channel | да | нет |
| page_id (user_data) | да | нет |
| phone (user_data) | да | нет |
| event_transaction_time | нет | да |
| event_source_url | нет | да |

## База данных

### Миграция 125_meta_capi_tracking.sql

**leads:**
- `ctwa_clid` - Click-to-WhatsApp Click ID (используется для business_messaging payload при наличии)

**dialog_analysis:**
- `capi_interest_sent` / `_sent_at` / `_event_id` - флаги Level 1
- `capi_qualified_sent` / `_sent_at` / `_event_id` - флаги Level 2
- `capi_scheduled_sent` / `_sent_at` / `_event_id` - флаги Level 3 (Scheduled → Purchase event_name)

**capi_events_log:**
- Аудит-лог всех отправленных событий
- Статус: `success` / `error` / `skipped`
- Ответ от Facebook API

### Миграция 153_add_capi_msg_count.sql

**dialog_analysis (новые поля):**
- `capi_msg_count` (INT, default 0) — счётчик входящих сообщений от рекламных лидов
- Считает только сообщения от контактов с `source_id` в таблице `leads`
- Сбрасывается в 0 при повторном клике на рекламу (для отправки нового Level 1 события)

**Важно:** `capi_msg_count` отделён от `incoming_count` — это позволяет:
- Считать только сообщения ПОСЛЕ клика по рекламе
- Не ломать существующую статистику

### Миграция 127_direction_capi_settings.sql

**account_directions (настройки CAPI на уровне направления):**
- `capi_enabled` (BOOLEAN) - включен ли CAPI для направления
- `capi_source` (TEXT) - источник событий: `whatsapp` или `crm`
- `capi_crm_type` (TEXT) - тип CRM: `amocrm` или `bitrix24`
- `capi_interest_fields` (JSONB) - поля CRM для Level 1 (Interest)
- `capi_qualified_fields` (JSONB) - поля CRM для Level 2 (Qualified)
- `capi_scheduled_fields` (JSONB) - поля CRM для Level 3 (Scheduled)

### Миграция 208_create_capi_settings_table.sql

**capi_settings (новая таблица):**
- Отдельная таблица для хранения CAPI настроек per-channel per-account
- `channel` — тип канала: `whatsapp`, `lead_forms`, `site`
- `pixel_id` — Pixel/Dataset ID
- `capi_access_token` — pixel-specific токен
- `capi_source` — источник: `whatsapp` (AI) или `crm`
- `capi_crm_type` — тип CRM: `amocrm` или `bitrix24`
- `capi_interest_fields` / `capi_qualified_fields` / `capi_scheduled_fields` — JSONB маппинги L1/L2/L3
- `ai_l2_description` / `ai_l3_description` / `ai_generated_prompt` — AI конфигурация
- `is_active` — soft delete
- UNIQUE: `(user_account_id, account_id, channel)` с NULLS NOT DISTINCT

### Миграция 209_migrate_direction_capi_to_settings.sql

Автоматическая миграция данных из `account_directions` WHERE `capi_enabled=TRUE` в `capi_settings`. Берётся самая свежая запись по `updated_at` для каждой комбинации `(user_account_id, account_id, channel)`.

### Миграция 203_capi_messaging_upgrade.sql

**account_directions (Messaging dataset поля):**
- `capi_access_token` (TEXT) - pixel-specific токен (из Events Manager), приоритет над ad_accounts/user_accounts.access_token
- `capi_event_level` (INTEGER, 1-3, NULL) - на каком уровне воронки отправлять Lead event (NULL = все)
- Page ID определяется автоматически по типу аккаунта: legacy → user_accounts.page_id, multi-account → ad_accounts.page_id

**Формат JSONB для CRM-полей:**
```json
[
  {
    "field_id": "123456",
    "field_name": "Статус лида",
    "field_type": "select",
    "enum_id": "789",
    "enum_value": "Заинтересован"
  }
]
```

Для Bitrix24 также поддерживается `entity_type` (contact/deal/lead).

**Формат JSONB для этапов воронки:**
```json
[
  {
    "field_id": "bitrix24:deal:1:C1:NEW",
    "field_name": "Сделки / Основная → Новая",
    "field_type": "pipeline_stage",
    "entity_type": "deal",
    "pipeline_id": 1,
    "status_id": "C1:NEW"
  }
]
```

## Настройка

### 1. Настройки CAPI через модуль "Meta CAPI" в Подключениях

> **Начиная с миграции 208**, настройки CAPI вынесены из направлений в отдельный модуль. Настройка выполняется через карточку "Meta CAPI" в разделе "Подключения" на странице Profile.

**Пошаговый визард (CapiWizard):**

**Шаг 1: Выбор канала**
- WhatsApp — конверсии из переписок
- Lead Forms — конверсии из лид-форм Meta (требует подключённую CRM)
- Сайт — конверсии с сайта (требует подключённую CRM)

**Шаг 2: Источник данных** (только для WhatsApp, если CRM подключена)
- AI анализ переписок — GPT-4o-mini анализирует диалоги
- CRM — отслеживание полей/этапов воронки

**Шаг 3: Pixel / Dataset ID + Access Token**
- Ввод ID пикселя или датасета из Meta Events Manager
- Опциональный pixel-specific access token

**Шаг 4: Конфигурация**

Для AI источника (WhatsApp):
- Описание критериев L2 (квалифицирован)
- Описание критериев L3 (записался/оплатил)
- Генерация промпта через API

Для CRM источника:
- Выбор режима: по полям CRM или по этапам воронки
- До 5 полей/этапов на каждый уровень (OR логика):
  - L1 Contact (интерес)
  - L2 Schedule (квалификация)
  - L3 StartTrial (запись/оплата)

### 1.1 Legacy: настройки CAPI в направлениях

> Старый подход (до миграции 208). Настройки хранились per-direction в `account_directions`. Resolver поддерживает fallback на legacy данные в переходный период.

**Что осталось в направлениях:**
- `capi_event_level` — на каком уровне воронки отправлять событие (1/2/3/NULL=все)

**Логика проверки CRM триггеров:**
- Если настроено несколько полей/этапов — используется логика OR
- Событие отправляется при совпадении хотя бы одного условия

### 2. Порог Interest события

ENV переменная для настройки порога счётчика сообщений:

```bash
CAPI_INTEREST_THRESHOLD=3  # default: 3 сообщения
META_CAPI_LEVEL2_EVENT=ADD_TO_CART  # ADD_TO_CART или SUBSCRIBE
WHATSAPP_CONVERSIONS_LEVEL2_EVENT=ADD_TO_CART  # (опционально) override для promoted_object custom_event_type
META_CAPI_ENABLE_BUSINESS_MESSAGING=true  # при наличии ctwa_clid
```

Событие Level 1 отправляется когда `capi_msg_count >= CAPI_INTEREST_THRESHOLD`.

### 3. Access Token

Приоритет:
1. `capi_settings.capi_access_token` (pixel-specific, из нового модуля)
2. `account_directions.capi_access_token` (legacy fallback)
3. `ad_accounts.access_token` (multi-account mode)
4. `user_accounts.access_token` (fallback)

> **Рекомендация:** Для Messaging dataset пикселей рекомендуется генерировать отдельный токен в Events Manager и указывать в настройках CAPI (`capi_access_token`).

### 4. ctwa_clid (Click-to-WhatsApp Click ID)

ctwa_clid извлекается из входящих ad-сообщений и используется для Meta CAPI payload в режиме `business_messaging` (если значение доступно).

**Извлечение из Evolution API (WHATSAPP-BAILEYS mode):**
```
data.message.contextInfo.externalAdReply.ctwaClid
```

**Извлечение ad-id (source_id) из Evolution API:**
- Приоритет: `contextInfo.externalAdReply.sourceId`
- Fallback: `message.key.sourceId` (legacy payload)
- Fallback управляется флагом:
```bash
EVOLUTION_AD_SOURCE_FALLBACK_ENABLED=true  # default: true
```

В логах `evolutionWebhooks.ts` фиксируется происхождение ad-id:
- `sourceIdOrigin=external`
- `sourceIdOrigin=referral`
- `sourceIdOrigin=key`
- `sourceIdOrigin=none`

**Путь в webhook payload:**
```typescript
const ctwaClid = message?.contextInfo?.externalAdReply?.ctwaClid;
const hasExternalAdReply = !!message?.contextInfo?.externalAdReply;
```

**Хранение:**
- `dialog_analysis.ctwa_clid` — основное хранилище для CAPI событий
- `leads.ctwa_clid` — дублирование для совместимости

**Важно:** Evolution API в режиме WHATSAPP-BAILEYS использует `externalAdReply`, а не `referral`.

## Поток данных

### Источник: WhatsApp

#### Level 1 (Interest/CompleteRegistration) — по счётчику сообщений

1. **Входящее сообщение** → `evolutionWebhooks.ts`
   - Если есть `source_id` в сообщении:
     - `handleAdLead()` создаёт/обновляет lead
     - **Сброс:** `capi_msg_count = 0`, `capi_interest_sent = false`
   - Вызывает `upsertDialogAnalysis()`

2. **upsertDialogAnalysis()** → `evolutionWebhooks.ts`
   - Проверяет `isAdLead()` — есть ли `source_id` в таблице `leads`
   - Если рекламный лид: `capi_msg_count++`
   - Если `capi_msg_count >= CAPI_INTEREST_THRESHOLD` (default: 3):
     - Вызывает `sendCapiInterestEvent()` → `POST /capi/interest-event`

3. **chatbot-service** → `/capi/interest-event`
   - Получает `pixelId` и `accessToken` через `getDirectionPixelInfo()`
   - Отправляет Level 1 событие через `sendCapiEventAtomic()`
   - Обновляет `capi_interest_sent = true`

#### Level 2, 3 (Qualified/Scheduled) — через Cron + AI анализ

**Архитектура:** Cron job раз в час анализирует диалоги, а не реактивно при каждом сообщении. Это экономит токены и не зависит от включённого бота.

**Критерии выборки для cron (SQL с JOIN):**
```sql
SELECT da.*, ad.name as direction_name
FROM dialog_analysis da
INNER JOIN account_directions ad ON da.direction_id = ad.id
WHERE da.capi_interest_sent = true        -- есть Interest (Level 1)
  AND da.capi_qualified_sent = false      -- нет Level 2
  AND da.capi_scheduled_sent = false      -- нет Level 3
  AND da.last_message > NOW() - INTERVAL '1 hour'  -- активность за час
  AND da.direction_id IS NOT NULL         -- есть направление
  AND ad.capi_enabled = true              -- CAPI включён для направления
ORDER BY da.last_message DESC
LIMIT 50;
```

**Поток:**

1. **Cron каждый час** (`capiAnalysisCron.ts`)
   - Выбирает диалоги по критериям выше (с JOIN на `account_directions`)
   - Использует lock (`isRunning`) для защиты от параллельного запуска
   - Batch processing с rate limiting между анализами

2. **Для каждого диалога:**
   - Загружает сообщения через `getDialogForCapi()`
   - Проверяет `capi_source` направления (whatsapp или crm)
   - Анализирует через GPT-4o-mini (`analyzeQualification()`)
   - Определяет: is_qualified, is_scheduled

3. **metaCapiClient**
   - Отправляет события в Meta CAPI атомарно
   - Обновляет флаги `capi_qualified_sent`, `capi_scheduled_sent`
   - Логирует в `capi_events_log`

**Преимущества cron-подхода:**
- Не зависит от включённого AI-бота
- Экономит токены (анализ только при активности)
- Работает автономно
- Легко масштабируется (batch processing)
- Lock предотвращает race conditions при длинных запусках

**ENV переменные:**
```bash
CAPI_CRON_ENABLED=true              # Включить cron
CAPI_CRON_SCHEDULE="0 * * * *"      # Каждый час (cron format)
CAPI_CRON_BATCH_SIZE=50             # Макс диалогов за запуск
CAPI_CRON_ACTIVITY_WINDOW=60        # Минут активности (default: 60)
CAPI_CRON_DELAY_MS=100              # Задержка между анализами (rate limiting)
```

**Ручной триггер для тестирования:**
```
POST /capi/trigger-analysis
Host: chatbot-service:8083

Response:
{
  "success": true,
  "dialogs_found": 15,
  "dialogs_processed": 12,
  "dialogs_skipped": 2,
  "errors": 1,
  "duration_ms": 4523
}
```

**Логирование cron:**
```
[capiAnalysisCron] === Starting CAPI analysis cron ===
[capiAnalysisCron] Found dialogs for CAPI analysis { count: 15 }
[capiAnalysisCron] Starting CAPI analysis for dialog { dialogId, contactPhone, directionName }
[capiAnalysisCron] CAPI analysis completed for dialog { dialogId, durationMs }
[capiAnalysisCron] === CAPI analysis cron completed === { found, processed, skipped, errors, avgTimePerDialog }
```

### Источник: CRM (field/stage mapping)

1. **Webhook от CRM** → `agent-service`
   - AMO CRM: изменение сделки/контакта
   - Bitrix24: изменение лида/сделки/контакта

2. **qualificationAgent** → `getCrmQualificationStatus()`
   - Загружает настройки CAPI направления
   - Если `capi_source === 'crm'`:
     - Получает текущие значения полей из CRM
     - Сравнивает с `capi_interest_fields`, `capi_qualified_fields`, `capi_scheduled_fields`:
       - по полям CRM
       - по этапам воронки (`field_type = pipeline_stage`)
     - Определяет уровни на основе совпадений (OR логика)

3. **metaCapiClient**
   - Отправляет события по совпавшим уровням
   - Обновляет флаги и логирует

## Счётчик сообщений (capi_msg_count)

### Логика работы

1. **Клиент кликает на рекламу, пишет первое сообщение:**
   - `handleAdLead()` создаёт lead с `source_id`
   - Сброс: `capi_msg_count = 0`, `capi_interest_sent = false`
   - `upsertDialogAnalysis()` инкрементирует: `capi_msg_count = 1`

2. **Клиент пишет второе, третье сообщение:**
   - `isAdLead() = true` (source_id есть в leads)
   - `capi_msg_count++` при каждом входящем сообщении

3. **При достижении порога (default: 3):**
   - Отправляется Level 1 событие через `/capi/interest-event`
   - `capi_interest_sent = true`

### Повторный клик на рекламу

Если тот же контакт кликнет на рекламу снова (даже с тем же `source_id`):
- `handleAdLead()` сбрасывает `capi_msg_count = 0`
- `capi_interest_sent = false`
- Level 1 событие отправится снова после 3 сообщений

Это корректное поведение — фактически происходит новое событие интереса.

### Клиент писал ДО рекламы

```
Сообщение 1 (без рекламы) → isAdLead = false → capi_msg_count = 0
Сообщение 2 (без рекламы) → isAdLead = false → capi_msg_count = 0
Сообщение 3 (С РЕКЛАМЫ!)  → handleAdLead сброс → capi_msg_count = 1
Сообщение 4              → isAdLead = true → capi_msg_count = 2
Сообщение 5              → isAdLead = true → capi_msg_count = 3 → CAPI!
```

Счётчик считает только сообщения ПОСЛЕ появления `source_id` в leads.

### API endpoint

```
POST /capi/interest-event
Host: chatbot-service:8083

Body:
{
  "instanceName": "my-instance",
  "contactPhone": "+77001234567"
}

Response (success):
{
  "success": true,
  "event": "LeadSubmitted",
  "eventId": "wa_abc123_lead_l1"
}

Response (already sent):
{
  "success": false,
  "error": "Event already sent or dialog not found"
}
```

## Дедупликация

- Флаги `capi_*_sent` предотвращают повторную отправку
- `event_id` генерируется детерминированно:
  - Level 1: `wa_{leadId|dialogId|phoneHash}_{lead_l1}`
  - Level 2: `wa_{leadId|dialogId|phoneHash}_{lead_l2}`
  - Level 3: `wa_{leadId|dialogId|phoneHash}_{lead_l3}`
- Facebook использует event_id для дедупликации на своей стороне
- **Interest:** сбрасывается при повторном клике на рекламу (новый цикл воронки)

## Логирование

Подробные логи во всех компонентах:

**Level 1 (Interest) — счётчик сообщений:**
```
[evolutionWebhooks] Reset CAPI counter for new ad click { instanceName, clientPhone }
[evolutionWebhooks] CAPI threshold reached, sending Level 1 event { contactPhone, capiMsgCount, threshold, directionId }
[evolutionWebhooks] CAPI Interest event sent successfully { instanceName, contactPhone }
[chatbot-service] Interest CAPI event request received { instanceName, contactPhone }
[chatbot-service] Interest CAPI event sent successfully { contactPhone, dialogId, directionId, eventName }
[metaCapiClient] Sending CAPI event { hasCtwaClid, actionSource, useBusinessMessaging, eventIdStrategy }
```

**Level 2, 3 — AI анализ:**
```
[qualificationAgent] Starting qualification analysis
[qualificationAgent] Qualification analysis complete { isInterested, isQualified, isScheduled }
[metaCapiClient] Sending CAPI event { pixelId, eventName, eventLevel }
[metaCapiClient] CAPI event sent successfully { eventId, eventsReceived }
```

**CRM source — детальная диагностика матчей (agent-service):**
```
[CRM CAPI] skip ... (source/type/enable mismatch) { settings: { interest: { total, stage, field }, ... } }
[CRM CAPI] AmoCRM level evaluation matched { matches, diagnostics, settings }
[CRM CAPI] Bitrix level evaluation matched { matches, diagnostics, settings }
[CRM CAPI] levels sent { correlationId, levels }
```

`diagnostics` включает по каждому уровню:
- `matched` — есть совпадение или нет
- `matchType` — `stage` / `field` / `none`
- `reason` — причина (`matched_stage`, `matched_field`, `no_field_match`, и т.д.)
- `matchedConfig` — конкретный конфиг, который сработал

## Пример CAPI запроса

### LeadSubmitted — Messaging dataset (WhatsApp)

```json
POST /v20.0/{pixel_id}/events
{
  "data": [{
    "event_name": "LeadSubmitted",
    "event_time": 1703520000,
    "event_id": "wa_abc123_lead_l1",
    "action_source": "business_messaging",
    "messaging_channel": "whatsapp",
    "user_data": {
      "ph": ["a1b2c3..."],
      "external_id": ["91991aa6..."],
      "country": ["d4e5f6..."],
      "ctwa_clid": "ARAk...",
      "page_id": "123456789012345"
    },
    "custom_data": {
      "event_level": 1,
      "channel": "whatsapp",
      "stage": "interest"
    }
  }],
  "access_token": "EAA..."
}
```

### CRM dataset — per-level events (Lead Forms / Сайт)

Для CRM dataset каждый уровень отправляет **разное событие**:

**Level 1 — Contact:**
```json
POST /v24.0/{dataset_id}/events
{
  "data": [{
    "event_name": "Contact",
    "event_time": 1703520000,
    "event_id": "wa_abc123_lead_l1",
    "action_source": "system_generated",
    "user_data": {
      "ph": ["a1b2c3..."],
      "lead_id": 12345678901234567,
      "external_id": ["91991aa6..."],
      "country": ["d4e5f6..."]
    },
    "custom_data": {
      "event_source": "crm",
      "lead_event_source": "Bitrix24",
      "level": "interest",
      "channel": "crm",
      "crm_source": "bitrix24"
    }
  }],
  "access_token": "..."
}
```

**Level 2 — Schedule:**
```json
{ "event_name": "Schedule", ... "custom_data": { "level": "qualified", ... } }
```

**Level 3 — StartTrial:**
```json
{ "event_name": "StartTrial", ... "custom_data": { "level": "scheduled", ... } }
```

> **Матчинг:** Для Lead Forms Meta матчит по `lead_id` (leadgen_id, 15-17 цифр) — это высший приоритет. Fallback на `ph` (hashed phone).

## Мульти-направления в отчётах

### Архитектура (миграции 129, 130)

Система поддерживает несколько WhatsApp направлений с разными пикселями в одном отчёте.

**Миграция 129** — добавляет `direction_id` в `dialog_analysis`:
```sql
ALTER TABLE dialog_analysis ADD COLUMN direction_id UUID REFERENCES account_directions(id);
-- Триггер автоматически заполняет direction_id через instance_name
```

**Миграция 130** — добавляет `directions_data` в `conversation_reports`:
```sql
ALTER TABLE conversation_reports ADD COLUMN directions_data JSONB DEFAULT '[]'::jsonb;
```

### Структура directions_data

```typescript
interface DirectionReportData {
  direction_id: string;
  direction_name: string;
  total_dialogs: number;
  new_dialogs: number;
  capi_enabled: boolean;
  capi_has_data: boolean;
  capi_distribution: { interest, qualified, scheduled };
  interest_distribution: { hot, warm, cold };
  incoming_messages: number;
  outgoing_messages: number;
  avg_response_time_minutes: number | null;
}
```

### Формат отчёта

Отчёт с секциями по направлениям:

```
📊 Отчёт по перепискам за 28 декабря 2025
━━━━━━━━━━━━━━━━━━━━━━

📈 ОБЩАЯ СТАТИСТИКА
• Всего диалогов: 150
• Новых: 25
• Сообщений: 📥 420 / 📤 380

━━━━━━━━━━━━━━━━━━━━━━
📁 ПО НАПРАВЛЕНИЯМ (2)

📌 Косметология
• Диалогов: 85 (новых: 15)
• Сообщений: 📥 240 / 📤 200

🎯 Воронка CAPI:
  👋 Интерес: 45
  ✅ Квалиф.: 12
  💳 Записался/оплатил: 5
  📊 Конверсия: 27%

📌 Стоматология
• Диалогов: 65 (новых: 10)
• Сообщений: 📥 180 / 📤 180

🌡️ Интерес: 🔥15 ☀️30 ❄️20
⏱️ Среднее время ответа: 45 сек
```

### Логика группировки

1. Диалоги группируются по `direction_id` (если миграция 129 применена)
2. Fallback: группировка по `instance_name` → `whatsapp_phone_numbers` → `direction`
3. Диалоги без направления попадают в категорию "Без направления"

### Обратная совместимость

Legacy поля сохраняются для старых отчётов:
- `capi_distribution` — агрегированные CAPI метрики
- `capi_source_used` — флаг использования CAPI
- `capi_direction_id` — ID первого направления с CAPI

## ROI Analytics

В разделе ROI Analytics (`/roi`) отображаются CAPI события для каждого лида:

| Колонка | Описание |
|---------|----------|
| Интерес | CAPI Level 1 — клиент проявил интерес (3+ сообщения) |
| Квал CAPI | CAPI Level 2 — клиент прошёл квалификацию |
| Запись | CAPI Level 3 — клиент записался на ключевой этап |

Данные берутся из `dialog_analysis` через API `/api/capi-events/:leadId`.

## CAPI Dashboard

Секция CAPI Events на главной странице Dashboard отображает агрегированную статистику CAPI событий.

### Расположение

```
Dashboard.tsx
    ├── SummaryStats
    ├── CapiEventsSection  ← CAPI метрики
    └── AutopilotSection
```

### Компоненты

**Backend:** `services/agent-service/src/routes/analytics.ts`
- Endpoint: `GET /analytics/capi-stats`
- Параметры: `user_account_id`, `since`, `until`
- Проверяет наличие направлений с `capi_enabled = true`
- Считает события по уровням из `capi_events_log`

**Frontend API:** `services/frontend/src/services/capiApi.ts`
- Timeout: 15 секунд
- Retry: до 3 попыток с экспоненциальной задержкой
- Валидация ответа

**Frontend Component:** `services/frontend/src/components/CapiEventsSection.tsx`
- 9 карточек в сетке 3x3
- Скрывается для TikTok платформы
- Скрывается если CAPI не включён ни для одного направления

### Отображаемые метрики

| Ряд | Метрики |
|-----|---------|
| 1 | CAPI Level 1, CAPI Level 2, CAPI Purchase (количество) |
| 2 | Лиды → Level 1 %, Level 1 → Level 2 %, Level 2 → Purchase % |
| 3 | Cost per Level 1, Cost per Level 2, Cost per Purchase |

### Расчёт стоимости

```typescript
const totalSpend = campaignStats.reduce((sum, s) => sum + s.spend, 0);
const costPerLead = totalSpend / capiStats.lead; // lead == Level 1 (CompleteRegistration)
const costPerRegistration = totalSpend / capiStats.registration;
const costPerSchedule = totalSpend / capiStats.schedule; // schedule == Purchase
```

### Логирование

Backend логирует в формате:
```
[capi-stats] Fetching CAPI stats { user_account_id, since, until }
[capi-stats] Successfully fetched CAPI stats { eventsCount, result, durationMs }
```

Frontend логирует в консоль:
```
[capiApi] Fetching CAPI stats: { userId, since, until }
[capiApi] Successfully fetched CAPI stats: { capiEnabled, lead, registration, schedule }
[CapiEventsSection] CAPI stats loaded: { capiEnabled, lead, registration, schedule, durationMs }
```

### Условия отображения

Секция **НЕ** отображается если:
1. Платформа TikTok
2. `capiEnabled === false` (нет направлений с включённым CAPI)
3. Произошла ошибка загрузки и нет кэшированных данных

## Troubleshooting

### События не отправляются

1. Проверить, выбран ли пиксель для направления
2. Проверить наличие access_token
3. Проверить логи `metaCapiClient`
4. Проверить таблицу `capi_events_log`

### CRM источник: события не триггерятся

1. Проверить, что у направления:
   - `capi_enabled = true`
   - `capi_source = 'crm'`
   - корректный `capi_crm_type` (`amocrm` или `bitrix24`)
2. Проверить, что в каждом уровне L1/L2/L3 есть минимум один валидный триггер
   - поле CRM (`field_id` + optional enum)
   - или этап воронки (`field_type='pipeline_stage'`, `status_id`, optional `pipeline_id`)
3. Проверить диагностические логи `CRM CAPI: ... evaluation ...`
4. Проверить, что webhook пришёл по нужному entity type (lead/deal) и совпадает с `entity_type` в конфиге этапа

### Bitrix24 CRM CAPI: полная цепочка и частые проблемы

**Цепочка для lead_forms + Bitrix24:**

```
Facebook Lead Form → agent-service (facebookWebhooks.ts)
    → Создание лида в БД
    → pushLeadToBitrix24Direct() (только если phone != null)
        → Сделка создана в Bitrix24
        → bitrix24_deal_id записывается в leads
    → Bitrix24 CRM: сделка двигается по воронке
        → Bitrix24 webhook (ONCRMDEALUPDATE)
            → handleDealEvent(): getDeal() + leads lookup по bitrix24_deal_id
            → syncDirectionCrmCapiForBitrixEntity(): evaluateBitrixCapiLevels()
            → sendCrmCapiLevels() → chatbot-service → Meta CAPI
```

**Частые проблемы:**

#### 1. `bitrix24_deal_id = NULL` у лидов

**Симптом:** Лиды в таблице `leads` имеют `bitrix24_deal_id = NULL`, вебхуки не могут их найти.

**Причины:**
- Лид без телефона (`phone = NULL`) — push в Bitrix24 пропускается (строка ~415 facebookWebhooks.ts: `bitrix24Enabled && phone`)
- Ошибка push в Bitrix24 (просроченный токен, ошибка API)
- Лид создан не через Facebook lead form (например, с сайта)

**Диагностика:**
```sql
-- Лиды без bitrix24_deal_id
SELECT id, phone, bitrix24_deal_id, direction_id, source_type, created_at
FROM leads
WHERE user_account_id = '{UUID}' AND bitrix24_deal_id IS NULL
ORDER BY created_at DESC LIMIT 20;
```

#### 2. Вебхуки Bitrix24 для "чужих" сделок (lookupError: PGRST116)

**Симптом:** В логах массово `"No local lead found for Bitrix24 deal"`.

**Это нормально!** Bitrix24 шлёт вебхуки для ВСЕХ сделок (с сайта, ручные, из других источников). В нашей системе только лиды с Facebook. Большинство вебхуков не найдут matching лид — это ожидаемое поведение. `PGRST116` = Supabase `.single()` вернул 0 строк.

#### 3. Несовпадение пайплайна (CAPI evaluation "without matches")

**Симптом:** Лид найден (`found: true`), но CAPI событие не отправлено.

**Причина:** Лид создаётся в Bitrix24 в дефолтном пайплайне (обычно `categoryId: "0"`), а CAPI маппинги настроены для других пайплайнов (например 17, 19, 23, 29).

**Решение:**
- Настроить push лидов в нужный пайплайн через `bitrix24_pipeline_id` в конфигурации Bitrix24
- Или добавить CAPI маппинги для дефолтного пайплайна (categoryId=0)
- CAPI сработает когда сделку переведут в один из настроенных пайплайнов на целевую стадию

**Диагностика:**
```sql
-- Проверить текущие стадии лидов
SELECT id, bitrix24_deal_id, current_status_id, current_pipeline_id
FROM leads WHERE bitrix24_deal_id IS NOT NULL AND user_account_id = '{UUID}'
ORDER BY created_at DESC LIMIT 10;

-- Проверить CAPI маппинги
SELECT channel, capi_interest_fields, capi_qualified_fields
FROM capi_settings WHERE account_id = '{UUID}' AND is_active = true;
```

#### 4. Дублирование вебхуков (два event_handler_id)

При подключении Bitrix24 к нескольким ad_accounts одного пользователя создаются отдельные webhook handlers. Каждый handler получает ВСЕ события CRM → вебхуки приходят парами. Это не ошибка, обработка идемпотентна.

**Диагностические логи (agent-service):**
```
"Bitrix24 deal fetched successfully"     — сделка получена из Bitrix24 API
"Bitrix24 deal webhook: lead lookup result" — результат поиска лида (found: true/false, lookupError)
"No local lead found for Bitrix24 deal"  — лид не найден (нормально для не-Facebook сделок)
"Lead updated from Bitrix24 deal webhook" — лид обновлён
"CRM CAPI settings resolved"            — CAPI настройки найдены
"CRM CAPI: Bitrix level evaluation matched" — стадия сделки совпала с маппингом
"CRM CAPI: levels sent"                 — CAPI события отправлены в chatbot-service
```

### Ошибки Facebook API

Типичные ошибки:
- `Invalid parameter` - проверить формат данных
- `(#100)` - пиксель не существует или нет доступа
- `Invalid OAuth access token` - обновить токен

### ctwa_clid = null (fallback mode)

**Симптомы:**
- `dialog_analysis.ctwa_clid` всегда null
- В логах видно что ctwa_clid приходит в webhook (не всегда)

**Важно:** при отсутствии `ctwa_clid` CAPI отправляется с fallback `action_source = system_generated`.

**Возможные причины:**

1. **Неправильный тип поля `last_message`**
   - Поле `last_message` в таблице `dialog_analysis` имеет тип `TIMESTAMPTZ`
   - Если код записывает текст сообщения вместо timestamp, INSERT падает
   - Ошибка: `invalid input syntax for type timestamp with time zone: "Здравствуйте..."`
   - Решение: использовать `timestamp.toISOString()` для `last_message`

2. **Constraint на `interest_level`**
   - Constraint `dialog_analysis_interest_level_check` разрешает только `'hot'`, `'warm'`, `'cold'`
   - Если код использует `interest_level: 'unknown'`, INSERT падает
   - Решение: не указывать `interest_level` при INSERT

3. **Race condition с chatbot-service**
   - chatbot-service может создать запись в `dialog_analysis` первым (без ctwa_clid)
   - evolutionWebhooks.ts потом пытается INSERT, получает conflict, делает UPDATE
   - Решение: `upsertDialogAnalysis()` использует `ctwa_clid || existing.ctwa_clid`

**Диагностика:**

```bash
# Проверить логи ctwa_clid
docker logs -f agent-service 2>&1 | grep -E "(ctwaClid|ctwa_clid|upsertDialogAnalysis)"

# Проверить ошибки INSERT/UPDATE
docker logs -f agent-service 2>&1 | grep -E "(Failed to create|Failed to update)"
```

**Проверка в базе:**

```sql
-- Записи с ctwa_clid
SELECT contact_phone, ctwa_clid, created_at
FROM dialog_analysis
WHERE ctwa_clid IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- Записи с рекламы без ctwa_clid (проблема)
SELECT contact_phone, created_at, funnel_stage
FROM dialog_analysis
WHERE ctwa_clid IS NULL
  AND created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;
```

### Проверка флагов

```sql
SELECT
  id,
  contact_phone,
  capi_interest_sent,
  capi_qualified_sent,
  capi_scheduled_sent
FROM dialog_analysis
WHERE capi_interest_sent = true;
```

### Interest не отправляется (счётчик)

**Симптомы:**
- `capi_msg_count` не инкрементируется
- Level 1 событие не отправляется после 3 сообщений

**Проверка:**

```sql
-- Проверить счётчик для конкретного лида
SELECT
  contact_phone,
  capi_msg_count,
  capi_interest_sent,
  direction_id
FROM dialog_analysis
WHERE contact_phone = '+7...';

-- Проверить, есть ли source_id в leads (рекламный лид)
SELECT
  chat_id,
  source_id,
  created_at
FROM leads
WHERE chat_id = '+7...';
```

**Возможные причины:**

1. **Нет source_id в leads:**
   - `isAdLead()` возвращает false
   - Счётчик не инкрементируется
   - Решение: проверить `handleAdLead()` и логи

2. **direction_id = null:**
   - Условие `existing.direction_id` не выполняется
   - CAPI не отправляется даже при достижении порога
   - Решение: проверить триггер миграции 129

3. **capi_interest_sent = true:**
   - Событие уже было отправлено
   - Решение: сбросить флаг или дождаться нового клика на рекламу

**Диагностика в логах:**

```bash
# Проверить логи счётчика
docker logs -f agent-service 2>&1 | grep -E "(capi_msg_count|CAPI threshold|isAdLead)"

# Проверить логи endpoint
docker logs -f chatbot-service 2>&1 | grep "Interest CAPI"
```

## Оптимизация рекламы

### Стратегия по неделям

С единым событием `Lead` оптимизация упрощается:

| Неделя | capi_event_level | Описание |
|--------|-----------------|----------|
| 1 | `1` (Интерес) | Оптимизация по быстрым сигналам (3+ сообщения) |
| 2 | `2` (Квалификация) | Переключить если 50+ Lead событий на уровне 1 |
| 3 | `3` (Запись) | Переключить если 50+ Lead событий на уровне 2 |

Переключение `capi_event_level` через UI направления — не требует пересоздания пикселя или кампании.
