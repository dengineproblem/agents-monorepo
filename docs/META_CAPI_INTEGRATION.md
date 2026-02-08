# Meta Conversions API (CAPI) Integration

Интеграция с Meta Conversions API для отправки событий конверсии из WhatsApp-диалогов и CRM.

## Обзор

Система отправляет события конверсии в Facebook для оптимизации рекламы. Поддерживается два источника данных:

1. **WhatsApp (LLM)** — автоматический анализ переписок с помощью GPT-4o-mini
2. **CRM (field/stage mapping)** — отслеживание изменений полей и этапов воронки в AMO CRM / Bitrix24

### Три уровня конверсии

| Уровень | Событие | Условие (WhatsApp) | Условие (CRM) |
|---------|---------|---------------------|---------------|
| 1 | `ViewContent` (INTEREST) | **Счётчик:** клиент с рекламы отправил 3+ сообщения | Поле CRM **или** этап воронки совпал с настройкой |
| 2 | `CompleteRegistration` (QUALIFIED) | **AI анализ:** клиент ответил на все квалификационные вопросы | Поле CRM **или** этап воронки совпал с настройкой |
| 3 | `Purchase` (BOOKED) | **AI анализ:** клиент записался на ключевой этап | Поле CRM **или** этап воронки совпал с настройкой |

> Уровень 3 использует `event_name = Purchase`, даже если фактически это "запись".

**Важно:** Level 1 (Interest) определяется детерминированно по счётчику сообщений, а Level 2 и 3 — через AI анализ переписки.

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
- Хеширование телефона/email (SHA256)
- external_id для дедупликации и матчинга
- action_source: `system_generated` (события от системы/бота/CRM)

**Типы событий:**

```typescript
const CAPI_EVENTS = {
  INTEREST: 'ViewContent',           // Level 1
  QUALIFIED: 'CompleteRegistration', // Level 2
  SCHEDULED: 'Purchase',             // Level 3
};
```

Для `Purchase`, если сумма неизвестна, отправляется `value=1` и `currency=KZT` по умолчанию.

## База данных

### Миграция 125_meta_capi_tracking.sql

**leads:**
- `ctwa_clid` - Click-to-WhatsApp Click ID (legacy, не обязателен для текущего Pixel/CAPI потока)

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
- Сбрасывается в 0 при повторном клике на рекламу (для отправки нового ViewContent)

**Важно:** `capi_msg_count` отделён от `incoming_count` — это позволяет:
- Считать только сообщения ПОСЛЕ клика по рекламе
- Не ломать существующую статистику

### Миграция 127_direction_capi_settings.sql

**account_directions (настройки CAPI на уровне направления):**
- `capi_enabled` (BOOLEAN) - включен ли CAPI для направления
- `capi_source` (TEXT) - источник событий: `whatsapp` или `crm`
- `capi_crm_type` (TEXT) - тип CRM: `amocrm` или `bitrix24`
- `capi_interest_fields` (JSONB) - поля CRM для Level 1 (Interest/ViewContent)
- `capi_qualified_fields` (JSONB) - поля CRM для Level 2 (Qualified/CompleteRegistration)
-- `capi_scheduled_fields` (JSONB) - поля CRM для Level 3 (Scheduled → Purchase event_name)

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
- `CRM (поля или этапы воронки)` — отслеживание полей/этапов в AMO CRM / Bitrix24

**Шаг 4 (только для CRM источника):**
- Выбор типа CRM (AMO CRM или Bitrix24)
  - Для каждого уровня конверсии выбирается тип триггера:
    - `Поля CRM`
    - `Этапы воронки`
  - Уровни:
    - Level 1 (Интерес / ViewContent)
    - Level 2 (Квалифицирован / CompleteRegistration)
    - Level 3 (Записался / Purchase)
  - Настройка доступна как при создании, так и при редактировании направления.

**Логика проверки CRM триггеров:**
- Если настроено несколько полей/этапов — используется логика OR
- Событие отправляется при совпадении хотя бы одного условия

### 2. Порог Interest события

ENV переменная для настройки порога счётчика сообщений:

```bash
CAPI_INTEREST_THRESHOLD=3  # default: 3 сообщения
```

Событие ViewContent отправляется когда `capi_msg_count >= CAPI_INTEREST_THRESHOLD`.

### 3. Access Token

Берётся из:
1. `ad_accounts.access_token` (multi-account mode)
2. `user_accounts.access_token` (fallback)

### 4. ctwa_clid (Click-to-WhatsApp Click ID, legacy)

ctwa_clid сохраняется для справки/атрибуции, но **не используется** в текущем Pixel/CAPI потоке и **не требуется** для отправки событий (action_source = `system_generated`).

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

#### Level 1 (Interest/ViewContent) — по счётчику сообщений

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
   - Отправляет `ViewContent` через `sendCapiEventAtomic()`
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
   - Отправляется ViewContent через `/capi/interest-event`
   - `capi_interest_sent = true`

### Повторный клик на рекламу

Если тот же контакт кликнет на рекламу снова (даже с тем же `source_id`):
- `handleAdLead()` сбрасывает `capi_msg_count = 0`
- `capi_interest_sent = false`
- ViewContent отправится снова после 3 сообщений

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
  "event": "ViewContent",
  "eventId": "abc123..."
}

Response (already sent):
{
  "success": false,
  "error": "Event already sent or dialog not found"
}
```

## Дедупликация

- Флаги `capi_*_sent` предотвращают повторную отправку
- `event_id` генерируется детерминированно: `wa_{leadId}_{interest|qualified|purchase}_v1`
- Facebook использует event_id для дедупликации на своей стороне
- **Interest:** сбрасывается при повторном клике на рекламу (новый цикл воронки)

## Логирование

Подробные логи во всех компонентах:

**Level 1 (Interest) — счётчик сообщений:**
```
[evolutionWebhooks] Reset CAPI counter for new ad click { instanceName, clientPhone }
[evolutionWebhooks] CAPI threshold reached, sending ViewContent { contactPhone, capiMsgCount, threshold, directionId }
[evolutionWebhooks] CAPI Interest event sent successfully { instanceName, contactPhone }
[chatbot-service] Interest CAPI event request { instanceName, contactPhone }
[chatbot-service] Interest CAPI event (ViewContent) sent successfully { contactPhone, dialogId, directionId }
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

```json
POST /v20.0/{pixel_id}/events
{
  "data": [{
    "event_name": "ViewContent",
    "event_time": 1703520000,
    "event_id": "abc123...",
    "event_source_url": "https://wa.me/",
    "action_source": "system_generated",
    "user_data": {
      "ph": ["a1b2c3..."],
      "external_id": "91991aa6"
    },
    "custom_data": {
      "event_level": 1
    }
  }],
  "access_token": "..."
}
```

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
| 1 | CAPI ViewContent, CAPI Registration, CAPI Purchase (количество) |
| 2 | Лиды → CAPI ViewContent %, ViewContent → Registration %, Registration → Purchase % |
| 3 | Cost per ViewContent, Cost per Registration, Cost per Purchase |

### Расчёт стоимости

```typescript
const totalSpend = campaignStats.reduce((sum, s) => sum + s.spend, 0);
const costPerLead = totalSpend / capiStats.lead; // lead == ViewContent
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

### Ошибки Facebook API

Типичные ошибки:
- `Invalid parameter` - проверить формат данных
- `(#100)` - пиксель не существует или нет доступа
- `Invalid OAuth access token` - обновить токен

### ctwa_clid = null (legacy, не блокирует CAPI)

**Симптомы:**
- `dialog_analysis.ctwa_clid` всегда null
- В логах видно что ctwa_clid приходит в webhook (не всегда)

**Важно:** ctwa_clid больше не требуется для отправки событий (action_source = `system_generated`), поэтому отсутствие значения не влияет на CAPI.

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
- ViewContent не отправляется после 3 сообщений

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

| Неделя | Событие для оптимизации |
|--------|------------------------|
| 1 | ViewContent (если 50+ событий) |
| 2 | ViewContent → CompleteRegistration (если 50+) |
| 3 | CompleteRegistration → Purchase |

Переключение на следующий уровень когда:
- Накоплено 50+ событий текущего уровня
- Стоимость события стабильна
