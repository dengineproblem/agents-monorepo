# CAPI Setup — Настройка Conversion API

## Цель
Настроить отправку событий конверсий в Meta CAPI для оптимизации рекламы.

## Уровни событий CAPI
| Уровень | Событие | Описание | Триггер |
|---------|---------|----------|---------|
| L1 | Lead / LeadSubmitted | Первый контакт | 3+ входящих сообщения или заявка |
| L2 | CompleteRegistration | Квалификация | AI определил интерес / CRM стадия |
| L3 | Schedule / Purchase | Запись / покупка | AI определил запись / CRM стадия |

## Предварительные требования
- Facebook Pixel ID (из рекламного кабинета)
- Facebook Access Token (с правами на отправку событий)
- SaaS pairing настроен

## Шаги

### 1. Получить SaaS credentials
```bash
SAAS_DB=$(psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -t -A -c "SELECT saas_db_url FROM config WHERE id = 1")
SAAS_ID=$(psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -t -A -c "SELECT saas_account_id FROM config WHERE id = 1")
```

### 2. Получить Pixel ID и Access Token
```bash
psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -c "SELECT facebook_pixel_id, fb_access_token FROM config WHERE id = 1;"
```

Если `facebook_pixel_id` пустой — попроси пользователя:
1. Открыть Facebook Business Manager → Events Manager
2. Скопировать Pixel ID

### 3. Спросить пользователя о настройке
- **Канал**: whatsapp, lead_forms или site
- **Источник данных**: whatsapp (AI квалификация) или crm (AmoCRM/Bitrix24)
- Если CRM: какие стадии соответствуют L2 и L3

### 4. Создать настройки CAPI в SaaS
```bash
psql "$SAAS_DB" <<SQL
INSERT INTO capi_settings (
  user_account_id,
  channel,
  pixel_id,
  capi_access_token,
  capi_source,
  is_active
)
VALUES (
  '$SAAS_ID',
  '{CHANNEL}',
  '{PIXEL_ID}',
  '{ACCESS_TOKEN}',
  '{SOURCE}',
  true
)
ON CONFLICT (user_account_id, channel) DO UPDATE SET
  pixel_id = EXCLUDED.pixel_id,
  capi_access_token = EXCLUDED.capi_access_token,
  capi_source = EXCLUDED.capi_source,
  is_active = true;
SQL
```

### 5. Настроить AI описания (для WhatsApp CAPI)
Если источник = whatsapp, нужно описать для AI что считать L2 и L3:
```bash
psql "$SAAS_DB" -c "
  UPDATE capi_settings SET
    ai_l2_description = 'Клиент выразил конкретный интерес к услуге, задал вопросы о ценах или записи',
    ai_l3_description = 'Клиент записался на приём, согласился на встречу или оставил контакты для связи'
  WHERE user_account_id = '$SAAS_ID' AND channel = '{CHANNEL}';
"
```

### 6. Настроить CRM поля (для CRM CAPI)
Если источник = crm:
```bash
psql "$SAAS_DB" -c "
  UPDATE capi_settings SET
    capi_crm_type = '{CRM_TYPE}',
    capi_interest_fields = '[{\"pipeline_id\": \"...\", \"status_id\": \"...\"}]',
    capi_qualified_fields = '[{\"pipeline_id\": \"...\", \"status_id\": \"...\"}]',
    capi_scheduled_fields = '[{\"pipeline_id\": \"...\", \"status_id\": \"...\"}]'
  WHERE user_account_id = '$SAAS_ID' AND channel = '{CHANNEL}';
"
```

### 7. Тестовая отправка события
```bash
# Тестовое событие через Facebook API
curl -s -X POST "https://graph.facebook.com/v23.0/{PIXEL_ID}/events?access_token={ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [{
      "event_name": "Lead",
      "event_time": '$(date +%s)',
      "action_source": "chat",
      "user_data": {
        "ph": ["test"]
      },
      "test_event_code": "TEST_EVENT"
    }]
  }'
```

Если ответ содержит `events_received: 1` — настройка работает.

### 8. Проверить лог событий
```bash
psql "$SAAS_DB" -c "
  SELECT event_name, event_level, capi_status, created_at
  FROM capi_events_log
  WHERE user_account_id = '$SAAS_ID'
  ORDER BY created_at DESC LIMIT 10;
"
```

## Результат
- CAPI настроен для канала
- AI квалификация или CRM стадии привязаны к уровням событий
- События автоматически отправляются в Meta при достижении уровней
