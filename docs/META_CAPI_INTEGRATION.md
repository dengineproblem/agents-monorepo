# Meta Conversions API (CAPI) Integration

Интеграция с Meta Conversions API для отправки событий конверсии из WhatsApp-диалогов.

## Обзор

Система автоматически анализирует WhatsApp-переписки с помощью LLM и отправляет события конверсии в Facebook для оптимизации рекламы.

### Три уровня конверсии

| Уровень | Событие | Условие |
|---------|---------|---------|
| 1 | `Lead` (INTEREST) | Клиент отправил 2+ сообщения |
| 2 | `CompleteRegistration` (QUALIFIED) | Клиент ответил на все квалификационные вопросы |
| 3 | `Schedule` (SCHEDULED) | Клиент записался на консультацию/встречу |

## Архитектура

```
WhatsApp → Evolution API → agent-service → chatbot-service
                               │                 │
                               │                 ├── chatbotEngine (ответы бота)
                               │                 │
                               │                 └── qualificationAgent (LLM анализ)
                               │                          │
                               │                          └── metaCapiClient
                               │                                  │
                               └──────────────────────────────────└── Meta CAPI
```

## Компоненты

### 1. qualificationAgent.ts

LLM-агент для анализа диалогов и определения уровня квалификации.

**Основные функции:**

- `analyzeQualification(dialog)` - анализирует диалог с помощью GPT-4o-mini
- `processDialogForCapi(dialog)` - отправляет CAPI события на основе анализа
- `getDialogForCapi(instanceName, contactPhone)` - получает данные диалога для анализа

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

## Настройка

### 1. Выбор пикселя для направления

При создании направления (любой objective) можно выбрать пиксель в разделе "Meta Conversions API":

```
CreateDirectionDialog.tsx:
- Загрузка списка пикселей из Facebook
- Сохранение pixel_id в default_ad_settings
```

### 2. Access Token

Берётся из:
1. `ad_accounts.access_token` (multi-account mode)
2. `user_accounts.access_token` (fallback)

### 3. ctwa_clid

Извлекается из:
- Evolution API webhook → `contextInfo.referral.ctwaClid`
- Сохраняется в `leads.ctwa_clid`

## Поток данных

1. **Входящее сообщение** → `evolutionWebhooks.ts`
   - Извлекает ctwa_clid из referral
   - Сохраняет в leads
   - Отправляет в chatbot-service

2. **chatbot-service** → `/process-message`
   - Собирает сообщения (5 сек буфер)
   - Генерирует ответ бота
   - **В фоне:** запускает qualificationAgent

3. **qualificationAgent**
   - Получает данные диалога
   - Анализирует через GPT-4o-mini
   - Определяет уровни: is_interested, is_qualified, is_scheduled

4. **metaCapiClient**
   - Проверяет, какие события ещё не отправлены
   - Отправляет события в Meta CAPI
   - Обновляет флаги в dialog_analysis
   - Логирует в capi_events_log

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
