# WABA Setup (WhatsApp Business API)

Подключение официального WhatsApp Business API (Meta Cloud API). Отвечает на "Подключи WABA", "Настрой WhatsApp Business API", "Подключи официальный WhatsApp".

---

## Предварительные требования

- Meta Business Account (верифицированный)
- WhatsApp Business App в Meta for Developers
- Phone Number ID (из Meta Business Suite → WhatsApp → API Setup)
- System User Access Token с permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
- App Secret (Settings → Basic → App Secret)

---

## Отличие от Baileys

| Аспект | Baileys (wa-onboarding) | WABA (этот скилл) |
|--------|------------------------|-------------------|
| Подключение | QR-код (моментально) | Meta верификация (часы/дни) |
| Стоимость | Бесплатно | Платно (per-conversation) |
| Надёжность | Может отключиться | Enterprise SLA |
| Функции | Базовые | Templates, read receipts, verified badge |
| Обработка | Hook внутри контейнера | webhook-service (внешний) |

---

## Workflow

### Шаг 1: Проверить текущий статус

```sql
SELECT waba_enabled, waba_phone_id, waba_access_token IS NOT NULL as has_token
FROM config WHERE id = 1;
```

Если WABA уже настроен — покажи статус и спроси нужно ли обновить.

### Шаг 2: Запросить данные у пользователя

1. **Phone Number ID** — из Meta Business Suite → WhatsApp → API Setup (числовой ID)
2. **Access Token** — System User Token (permanent, не temporary)
3. **App Secret** — из Meta App Dashboard → Settings → Basic → App Secret
4. **Номер телефона** — в международном формате (+77001234567)

### Шаг 3: Сохранить в config (tenant DB)

```sql
UPDATE config SET
  waba_enabled = true,
  waba_phone_id = '{phone_number_id}',
  waba_access_token = '{access_token}',
  waba_app_secret = '{app_secret}',
  waba_verify_token = 'openclaw_waba_2026',
  updated_at = NOW()
WHERE id = 1;
```

### Шаг 4: Зарегистрировать маппинг (shared DB)

Это нужно выполнить в ОБЩЕЙ БД openclaw (не в tenant DB):

```bash
psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw" -c "
  INSERT INTO waba_phone_mapping (waba_phone_id, slug, phone_number, waba_app_secret, waba_access_token)
  VALUES ('{phone_number_id}', '{{SLUG}}', '{phone_number}', '{app_secret}', '{access_token}')
  ON CONFLICT (waba_phone_id) DO UPDATE SET
    slug = EXCLUDED.slug,
    phone_number = EXCLUDED.phone_number,
    waba_app_secret = EXCLUDED.waba_app_secret,
    waba_access_token = EXCLUDED.waba_access_token,
    is_active = true,
    updated_at = NOW();
"
```

### Шаг 5: Настроить Webhook в Meta Dashboard

Покажи пользователю пошаговую инструкцию:

1. Перейти в **Meta for Developers** → твоё приложение → **WhatsApp** → **Configuration**
2. В секции **Webhook**:
   - **Callback URL**: `https://app.performanteaiagency.com/openclaw/webhooks/waba`
   - **Verify Token**: `openclaw_waba_2026`
3. Нажать **Verify and Save**
4. Подписаться на поле: **messages** (обязательно!)

### Шаг 6: Тестирование

Попроси пользователя отправить тестовое сообщение на WABA номер с другого телефона.

Проверь что оно появилось в БД:

```sql
-- Проверить wa_messages
SELECT phone, direction, channel, message_text, created_at
FROM wa_messages ORDER BY created_at DESC LIMIT 5;

-- Проверить wa_dialogs
SELECT phone, name, incoming_count, outgoing_count, waba_window_expires_at
FROM wa_dialogs ORDER BY last_message DESC LIMIT 5;
```

Если записей нет — проверить:
1. Webhook подписан на `messages`?
2. Verify Token правильный?
3. Access Token имеет нужные permissions?

### Шаг 7: Настроить промпт чатбота (опционально)

```sql
UPDATE config SET waba_bot_system_prompt = 'Ты — ассистент компании {название}.
Отвечай кратко на русском.
Услуги: {список}
Цены: {прайс}
Для записи попроси имя и удобное время.' WHERE id = 1;
```

---

## Ручная отправка сообщений

Из контейнера агента:
```bash
send-waba.sh +77001234567 "Текст сообщения"
```

---

## Формат ответа

```
📱 *WABA подключён*

✅ Phone Number ID: {phone_number_id}
✅ Номер: {phone_number}
✅ Webhook: https://app.performanteaiagency.com/openclaw/webhooks/waba
✅ Чатбот: Claude Haiku 4.5 (автоответ)

Теперь все входящие WABA сообщения обрабатываются автоматически.
Лиды с рекламы (Click-to-WhatsApp) привязываются к креативам через ad_creative_mapping.

💡 Для настройки CAPI: `skills/wa-capi-setup/SKILL.md`
💡 Для настройки промпта чатбота:
   UPDATE config SET waba_bot_system_prompt = '...' WHERE id = 1;
```
