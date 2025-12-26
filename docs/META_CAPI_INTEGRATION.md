# Meta Conversions API (CAPI) Integration

Интеграция с Meta Conversions API для отправки событий конверсии из WhatsApp-диалогов и CRM.

## Обзор

Система отправляет события конверсии в Facebook для оптимизации рекламы. Поддерживается два источника данных:

1. **WhatsApp (LLM)** — автоматический анализ переписок с помощью GPT-4o-mini
2. **CRM (field mapping)** — отслеживание изменений полей в AMO CRM / Bitrix24

### Три уровня конверсии

| Уровень | Событие | Условие (WhatsApp) | Условие (CRM) |
|---------|---------|---------------------|---------------|
| 1 | `Lead` (INTEREST) | Клиент отправил 2+ сообщения | Поле CRM установлено в нужное значение |
| 2 | `CompleteRegistration` (QUALIFIED) | Клиент ответил на все квалификационные вопросы | Поле CRM установлено в нужное значение |
| 3 | `Schedule` (SCHEDULED) | Клиент записался на консультацию/встречу | Поле CRM установлено в нужное значение |

## Архитектура

```
WhatsApp → Evolution API → agent-service → chatbot-service
                               │                 │
                               │                 ├── chatbotEngine (ответы бота)
                               │                 │
                               │                 └── qualificationAgent
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
```

### CRM Webhooks (для CRM источника)

```
AMO CRM / Bitrix24
        │
        └── Webhook при изменении поля
                │
                └── agent-service
                        │
                        └── Проверка capi_*_fields для направления
                                │
                                └── metaCapiClient → Meta CAPI
```

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

### 2. metaCapiClient.ts

Клиент для отправки событий в Meta Conversions API.

**Особенности:**
- Хеширование телефона/email (SHA256)
- Поддержка ctwa_clid для Click-to-WhatsApp атрибуции
- action_source: `business_messaging`
- messaging_channel: `whatsapp`

**Типы событий:**

```typescript
const CAPI_EVENTS = {
  INTEREST: 'Lead',                  // Level 1
  QUALIFIED: 'CompleteRegistration', // Level 2
  SCHEDULED: 'Schedule',             // Level 3
};
```

## База данных

### Миграция 125_meta_capi_tracking.sql

**leads:**
- `ctwa_clid` - Click-to-WhatsApp Click ID для атрибуции

**dialog_analysis:**
- `capi_interest_sent` / `_sent_at` / `_event_id` - флаги Level 1
- `capi_qualified_sent` / `_sent_at` / `_event_id` - флаги Level 2
- `capi_scheduled_sent` / `_sent_at` / `_event_id` - флаги Level 3

**capi_events_log:**
- Аудит-лог всех отправленных событий
- Статус: `success` / `error` / `skipped`
- Ответ от Facebook API

### Миграция 127_direction_capi_settings.sql

**account_directions (настройки CAPI на уровне направления):**
- `capi_enabled` (BOOLEAN) - включен ли CAPI для направления
- `capi_source` (TEXT) - источник событий: `whatsapp` или `crm`
- `capi_crm_type` (TEXT) - тип CRM: `amocrm` или `bitrix24`
- `capi_interest_fields` (JSONB) - поля CRM для Level 1 (Interest/Lead)
- `capi_qualified_fields` (JSONB) - поля CRM для Level 2 (Qualified/CompleteRegistration)
- `capi_scheduled_fields` (JSONB) - поля CRM для Level 3 (Scheduled/Schedule)

**Формат JSONB для CRM полей:**
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

## Настройка

### 1. Настройки CAPI при создании направления

При создании направления в `CreateDirectionDialog.tsx` доступны настройки CAPI:

**Шаг 1: Включение CAPI**
- Переключатель "Включить Meta CAPI"
- При включении появляются дополнительные опции

**Шаг 2: Выбор пикселя**
- Если есть другие направления с пикселем — предлагается использовать тот же
- Предупреждение: "Аудитории разных направлений будут агрегированы"
- Или выбор нового пикселя из списка

**Шаг 3: Выбор источника событий**
- `WhatsApp (AI анализ)` — LLM анализирует переписку
- `CRM (поля)` — отслеживание полей в AMO CRM / Bitrix24

**Шаг 4 (только для CRM источника):**
- Выбор типа CRM (AMO CRM или Bitrix24)
- Настройка полей для каждого уровня конверсии:
  - Level 1 (Интерес / Lead)
  - Level 2 (Квалифицирован / CompleteRegistration)
  - Level 3 (Записался / Schedule)

**Логика проверки CRM полей:**
- Если настроено несколько полей — используется логика OR
- Событие отправляется при совпадении хотя бы одного поля

### 2. Access Token

Берётся из:
1. `ad_accounts.access_token` (multi-account mode)
2. `user_accounts.access_token` (fallback)

### 3. ctwa_clid

Извлекается из:
- Evolution API webhook → `contextInfo.referral.ctwaClid`
- Сохраняется в `leads.ctwa_clid`

## Поток данных

### Источник: WhatsApp (LLM анализ)

1. **Входящее сообщение** → `evolutionWebhooks.ts`
   - Извлекает ctwa_clid из referral
   - Сохраняет в leads
   - Отправляет в chatbot-service

2. **chatbot-service** → `/process-message`
   - Собирает сообщения (5 сек буфер)
   - Генерирует ответ бота
   - **В фоне:** запускает qualificationAgent

3. **qualificationAgent**
   - Загружает настройки CAPI направления
   - Проверяет `capi_enabled` и `capi_source`
   - Если `capi_source === 'whatsapp'`:
     - Анализирует через GPT-4o-mini
     - Определяет уровни: is_interested, is_qualified, is_scheduled

4. **metaCapiClient**
   - Проверяет, какие события ещё не отправлены
   - Отправляет события в Meta CAPI
   - Обновляет флаги в dialog_analysis
   - Логирует в capi_events_log

### Источник: CRM (field mapping)

1. **Webhook от CRM** → `agent-service`
   - AMO CRM: изменение сделки/контакта
   - Bitrix24: изменение лида/сделки/контакта

2. **qualificationAgent** → `getCrmQualificationStatus()`
   - Загружает настройки CAPI направления
   - Если `capi_source === 'crm'`:
     - Получает текущие значения полей из CRM
     - Сравнивает с `capi_interest_fields`, `capi_qualified_fields`, `capi_scheduled_fields`
     - Определяет уровни на основе совпадений (OR логика)

3. **metaCapiClient**
   - Отправляет события по совпавшим уровням
   - Обновляет флаги и логирует

## Дедупликация

- Флаги `capi_*_sent` предотвращают повторную отправку
- `event_id` генерируется уникально для каждого события
- Facebook использует event_id для дедупликации на своей стороне

## Логирование

Подробные логи во всех компонентах:

```
[qualificationAgent] Starting qualification analysis
[qualificationAgent] Qualification analysis complete { isInterested, isQualified, isScheduled }
[metaCapiClient] Sending CAPI event { pixelId, eventName, eventLevel }
[metaCapiClient] CAPI event sent successfully { eventId, eventsReceived }
```

## Пример CAPI запроса

```json
POST /v20.0/{pixel_id}/events
{
  "data": [{
    "event_name": "Lead",
    "event_time": 1703520000,
    "event_id": "abc123...",
    "event_source_url": "https://wa.me/",
    "action_source": "business_messaging",
    "messaging_channel": "whatsapp",
    "user_data": {
      "ph": ["a1b2c3..."],
      "ctwa_clid": "click-id-from-ad"
    },
    "custom_data": {
      "event_level": 1
    }
  }],
  "access_token": "..."
}
```

## Troubleshooting

### События не отправляются

1. Проверить, выбран ли пиксель для направления
2. Проверить наличие access_token
3. Проверить логи `metaCapiClient`
4. Проверить таблицу `capi_events_log`

### Ошибки Facebook API

Типичные ошибки:
- `Invalid parameter` - проверить формат данных
- `(#100)` - пиксель не существует или нет доступа
- `Invalid OAuth access token` - обновить токен

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

## Оптимизация рекламы

### Стратегия по неделям

| Неделя | Событие для оптимизации |
|--------|------------------------|
| 1 | Lead (если 50+ событий) |
| 2 | Lead → CompleteRegistration (если 50+) |
| 3 | CompleteRegistration → Schedule |

Переключение на следующий уровень когда:
- Накоплено 50+ событий текущего уровня
- Стоимость события стабильна
