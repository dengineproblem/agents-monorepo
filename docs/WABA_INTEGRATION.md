# WABA (Meta Cloud API) Integration

## Обзор

WABA (WhatsApp Business API) — официальное API от Meta для отправки и получения WhatsApp сообщений. В отличие от Evolution API (серый WhatsApp через QR-код), WABA работает напрямую через Meta Cloud API.

### Два типа подключения WhatsApp

| Параметр | Evolution API | WABA (Meta Cloud API) |
|----------|---------------|----------------------|
| Тип | Серый (неофициальный) | Официальный |
| Подключение | QR-код | Настройка в Meta Business Suite |
| Стабильность | Могут быть баны | Стабильно |
| Webhook URL | Evolution API сервер | Прямой webhook от Meta |
| `conversion_source` | `Evolution_API` | `WABA` |

---

## Архитектура

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             Meta Cloud API                                │
│  (WhatsApp Business Platform → Webhook → наш сервер)                     │
└────────────────────────────────────────────────────────────────────────────
                                    │
                                    ▼  POST /webhooks/waba
┌──────────────────────────────────────────────────────────────────────────┐
│                          agent-service (Fastify)                          │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  wabaWebhooks.ts                                                     │ │
│  │                                                                      │ │
│  │  GET  /webhooks/waba  — Верификация webhook (hub.verify_token)      │ │
│  │  POST /webhooks/waba  — Приём сообщений                             │ │
│  │                                                                      │ │
│  │  1. Проверка X-Hub-Signature-256 (HMAC-SHA256)                      │ │
│  │  2. Парсинг WabaWebhookPayload                                      │ │
│  │  3. Обработка входящих сообщений (regular + ad referral)            │ │
│  │  4. Создание/обновление lead (только ad referral)                   │ │
│  │  5. CAPI tracking (Level 1 после N сообщений, только ad referral)   │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  wabaHelpers.ts                                                      │ │
│  │                                                                      │ │
│  │  - TypeScript типы (WabaWebhookPayload, WabaMessage, etc.)          │ │
│  │  - verifyWabaSignature() — проверка подписи                         │ │
│  │  - normalizeWabaPhone() — нормализация телефона                     │ │
│  │  - extractMessageText() — извлечение текста из разных типов         │ │
│  │  - hasAdReferral() — проверка наличия рекламного источника          │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  whatsappNumbers.ts (API для управления номерами)                   │ │
│  │                                                                      │ │
│  │  - connection_type: 'evolution' | 'waba'                            │ │
│  │  - waba_phone_id: Meta Phone Number ID                              │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          Supabase (PostgreSQL)                           │
│                                                                          │
│  whatsapp_phone_numbers                                                  │
│    ├── connection_type VARCHAR(20) — 'evolution' или 'waba'             │
│    └── waba_phone_id VARCHAR(50) — Meta Phone Number ID                 │
│                                                                          │
│  leads                                                                   │
│    └── conversion_source — 'WABA' для сообщений через Meta Cloud API   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Файлы интеграции

### Backend (agent-service)

| Файл | Описание |
|------|----------|
| `src/routes/wabaWebhooks.ts` | Webhook handlers (GET верификация, POST обработка) |
| `src/lib/wabaHelpers.ts` | TypeScript типы и утилиты |
| `src/routes/whatsappNumbers.ts` | CRUD API для номеров с поддержкой `connection_type` и `waba_phone_id` |
| `src/server.ts` | Регистрация роутов + custom content type parser для rawBody |

### Frontend

| Файл | Описание |
|------|----------|
| `src/services/whatsappApi.ts` | API клиент с типом `ConnectionType` |
| `src/components/profile/WhatsAppNumbersCard.tsx` | Форма добавления номера с выбором типа |
| `src/components/profile/WhatsAppConnectionCard.tsx` | Отображение бейджа WABA |

### База данных

| Файл | Описание |
|------|----------|
| `migrations/161_add_waba_phone_id.sql` | Добавление полей `connection_type` и `waba_phone_id` |

---

## Переменные окружения

```bash
# Включение/выключение WABA webhook
WABA_WEBHOOK_ENABLED=true|false  # По умолчанию: false

# Токен для верификации webhook (hub.verify_token)
WABA_VERIFY_TOKEN=your_verify_token

# App Secret для проверки подписи X-Hub-Signature-256
WABA_APP_SECRET=your_app_secret

# Порог сообщений для отправки CAPI Level 1 event
CAPI_INTEREST_THRESHOLD=3  # По умолчанию: 3

# Событие для Level 2 (квалификация): ADD_TO_CART или SUBSCRIBE
META_CAPI_LEVEL2_EVENT=ADD_TO_CART

# Разрешить business_messaging payload при наличии ctwa_clid
META_CAPI_ENABLE_BUSINESS_MESSAGING=true
```

### Отключение WABA

Если `WABA_WEBHOOK_ENABLED` не установлен или не равен `true`, webhook:
- Принимает все запросы (возвращает `200 OK`)
- Не обрабатывает сообщения
- Не создаёт leads

Это позволяет безопасно деплоить без настроенного WABA.

---

## Настройка в Meta Business Suite

### 1. Создание приложения

1. Перейти в [Meta for Developers](https://developers.facebook.com/)
2. Создать приложение типа "Business"
3. Добавить продукт "WhatsApp"

### 2. Получение токенов

1. **App Secret** — Settings → Basic → App Secret
   - Используется для `WABA_APP_SECRET`

2. **Phone Number ID** — WhatsApp → API Setup → Phone Number ID
   - Вводится при добавлении номера в нашу систему (`waba_phone_id`)

3. **Verify Token** — любая строка, которую вы придумаете
   - Используется для `WABA_VERIFY_TOKEN`

### 3. Настройка Webhook

1. WhatsApp → Configuration → Webhook
2. Callback URL: `https://your-domain.com/api/webhooks/waba`
3. Verify Token: значение из `WABA_VERIFY_TOKEN`
4. Подписаться на поля: `messages`

### 4. Добавление номера в систему

1. Профиль → WhatsApp номера → Добавить
2. Выбрать тип: **Meta Cloud API (WABA)**
3. Ввести номер в международном формате: `+77001234567`
4. Ввести **WABA Phone Number ID** из Meta Business Suite

---

## Структура данных

### WabaWebhookPayload (входящий webhook)

```typescript
interface WabaWebhookPayload {
  object: 'whatsapp_business_account';
  entry: [{
    id: string;  // WhatsApp Business Account ID
    changes: [{
      value: {
        messaging_product: 'whatsapp';
        metadata: {
          display_phone_number: string;  // Ваш номер: "77001234567"
          phone_number_id: string;       // Meta Phone Number ID
        };
        contacts?: [{
          profile: { name: string };
          wa_id: string;  // Номер отправителя
        }];
        messages?: [{
          from: string;      // Номер отправителя: "79001234567"
          id: string;        // Message ID
          timestamp: string; // Unix timestamp
          type: 'text' | 'image' | 'audio' | ...;
          text?: { body: string };
          referral?: {       // Данные рекламы (Click-to-WhatsApp)
            source_id: string;      // Facebook Ad ID
            source_type: 'ad';
            source_url: string;
            headline?: string;
            body?: string;
            ctwa_clid?: string;     // Click ID для CAPI
          };
        }];
      };
      field: 'messages';
    }];
  }];
}
```

### Referral (рекламные данные)

Когда пользователь кликает на рекламу Click-to-WhatsApp, первое сообщение содержит `referral`:

```json
{
  "referral": {
    "source_id": "120212631234567890",
    "source_type": "ad",
    "source_url": "https://fb.me/1234567890",
    "headline": "Заголовок объявления",
    "body": "Текст объявления",
    "ctwa_clid": "ARAkLBMN..."
  }
}
```

Это позволяет:
- Привязать лида к конкретной рекламе
- Отправлять CAPI события с `ctwa_clid`
- Отслеживать эффективность рекламы

---

## Логика обработки

### 1. Верификация webhook (GET)

```
GET /webhooks/waba?hub.mode=subscribe&hub.verify_token=xxx&hub.challenge=123
```

Если `hub.verify_token` совпадает с `WABA_VERIFY_TOKEN`, возвращаем `hub.challenge`.

### 2. Обработка сообщений (POST)

1. **Проверка подписи** — сравнение `X-Hub-Signature-256` с HMAC-SHA256 от raw body
2. **Дедупликация** — по `message.id` (короткое in-memory TTL окно)
3. **Поиск номера** — строго по `waba_phone_id` (Meta `metadata.phone_number_id`)
   - `display_phone_number` не используется для матчинга, fallback по `phone_number` отключён
4. **Маршрутизация**:
   - если есть `referral.source_id` (реклама) → resolve creative/direction → upsert lead → dialog_analysis + CAPI counters
   - иначе → dialog_analysis + (если бот привязан к инстансу) вызов chatbot `/process-message`

### 3. CAPI Integration

После N сообщений (по умолчанию 3) отправляется **Level 1** event (`CompleteRegistration`) через CAPI:

```
dialog_analysis.capi_msg_count >= CAPI_INTEREST_THRESHOLD
→ POST /capi/interest-event → Meta Conversions API
```

Сопоставление уровней событий:

| Уровень | custom_event_type | CAPI event_name |
|---------|-------------------|-----------------|
| Level 1 | `COMPLETE_REGISTRATION` | `CompleteRegistration` |
| Level 2 | `ADD_TO_CART` или `SUBSCRIBE` | `AddToCart` или `Subscribe` |
| Level 3 | `PURCHASE` | `Purchase` |

По `ctwa_clid`:
- Если `ctwa_clid` есть и `META_CAPI_ENABLE_BUSINESS_MESSAGING=true`, отправляется payload с `action_source=business_messaging`, `messaging_channel=whatsapp`.
- Если `ctwa_clid` отсутствует, используется fallback `action_source=system_generated`.

---

## Безопасность

### X-Hub-Signature-256

Meta подписывает все webhook payload с помощью HMAC-SHA256:

```
signature = HMAC-SHA256(app_secret, raw_body)
header = "sha256=" + signature
```

Проверка в `wabaHelpers.ts`:
```typescript
function verifyWabaSignature(rawBody, signature, appSecret): boolean {
  const expected = crypto.createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature.replace('sha256=', ''), 'hex')
  );
}
```

### Raw Body Handling

Для проверки подписи нужен **raw body** (до JSON парсинга). В Fastify это реализовано через custom content type parser в `server.ts`:

```typescript
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  (req as any).rawBody = body;  // Сохраняем для signature verification
  try {
    const json = JSON.parse(body.toString());
    done(null, json);
  } catch (err: any) {
    done(err, undefined);
  }
});
```

---

## Отладка

### Логи

```bash
# Все WABA логи
docker-compose logs agent-service | grep WABA

# Только ошибки
docker-compose logs agent-service | grep "WABA.*error"
```

### Тестирование webhook

```bash
# Верификация
curl "https://your-domain.com/api/webhooks/waba?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"
# Ожидается: test123

# Тестовый POST (без подписи — только для dev)
curl -X POST https://your-domain.com/api/webhooks/waba \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
# Ожидается: {"success":true}
```

### Проверка в БД

```sql
-- Номера с WABA
SELECT phone_number, connection_type, waba_phone_id
FROM whatsapp_phone_numbers
WHERE connection_type = 'waba';

-- Лиды от WABA
SELECT id, chat_id, source_id, conversion_source, created_at
FROM leads
WHERE conversion_source = 'WABA'
ORDER BY created_at DESC
LIMIT 10;
```

---

## Миграция с Evolution на WABA

1. **Добавить WABA номер** (не удаляя Evolution)
2. **Настроить webhook** в Meta Business Suite
3. **Установить** `WABA_WEBHOOK_ENABLED=true`
4. **Тестирование** — отправить тестовое сообщение
5. **Переключение** — обновить `connection_type` существующего номера на `waba`

```sql
UPDATE whatsapp_phone_numbers
SET connection_type = 'waba',
    waba_phone_id = '123456789012345'
WHERE phone_number = '+77001234567';
```

---

## Ограничения

1. **Только сообщения с рекламы** — обычные сообщения (без `referral`) игнорируются
2. **Нет отправки** — WABA webhook только получает, для отправки нужен отдельный API
3. **24-часовое окно** — Meta ограничивает ответы на сообщения 24 часами

---

## FAQ

**Q: Как отключить WABA если возникают ошибки?**
A: Установить `WABA_WEBHOOK_ENABLED=false` или удалить переменную.

**Q: Где взять WABA Phone Number ID?**
A: Meta Business Suite → WhatsApp → API Setup → Phone Number ID (числовой ID).

**Q: Почему сообщения не обрабатываются?**
A: Проверьте:
1. `WABA_WEBHOOK_ENABLED=true`
2. Номер добавлен с `connection_type=waba` и правильным `waba_phone_id`
3. Webhook подписан на `messages` в Meta Business Suite

**Q: Как тестировать без реальной рекламы?**
A: Используйте Meta's Webhook Test Tool в App Dashboard для отправки тестовых payload.
