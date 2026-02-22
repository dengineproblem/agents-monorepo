# WhatsApp Onboarding — Подключение WhatsApp

## Цель
Подключить WhatsApp через Evolution API и привязать AI чатбота.

## Предварительные требования
- SaaS pairing настроен (`saas_account_id` не NULL в config)
- Evolution API запущен (доступен через chatbot-router)

## Шаги

### 1. Проверить SaaS pairing
```bash
psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -c "SELECT saas_account_id, saas_db_url FROM config WHERE id = 1;"
```
Если `saas_account_id` IS NULL — сообщи пользователю что нужно настроить SaaS pairing.

### 2. Создать инстанс в Evolution API
```bash
curl -s -X POST http://openclaw-chatbot-router:3002/api/evolution/instance/create \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "{{SLUG}}_bot",
    "integration": "WHATSAPP-BAILEYS",
    "webhookEvents": ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"]
  }'
```

### 3. Зарегистрировать инстанс в SaaS
```bash
SAAS_DB=$(psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -t -A -c "SELECT saas_db_url FROM config WHERE id = 1")
SAAS_ID=$(psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -t -A -c "SELECT saas_account_id FROM config WHERE id = 1")
SAAS_AD_ID=$(psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -t -A -c "SELECT saas_ad_account_id FROM config WHERE id = 1")

psql "$SAAS_DB" -c "
  INSERT INTO whatsapp_instances (instance_name, user_account_id, account_id, status)
  VALUES ('{{SLUG}}_bot', '$SAAS_ID', '$SAAS_AD_ID', 'disconnected')
  ON CONFLICT (instance_name) DO NOTHING;
"
```

### 4. Получить QR-код
```bash
curl -s http://openclaw-chatbot-router:3002/api/evolution/instance/connect/{{SLUG}}_bot
```

Покажи QR-код пользователю и объясни:
1. Откройте WhatsApp на телефоне
2. Настройки → Связанные устройства → Привязать устройство
3. Отсканируйте QR-код

### 5. Проверить подключение
Подожди 15-30 секунд после сканирования, затем проверь:
```bash
curl -s http://openclaw-chatbot-router:3002/api/evolution/instance/connectionState/{{SLUG}}_bot
```

Если `state: "open"` — подключение успешно.

### 6. Получить номер телефона
```bash
SAAS_DB=$(psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -t -A -c "SELECT saas_db_url FROM config WHERE id = 1")
psql "$SAAS_DB" -c "SELECT phone_number, status FROM whatsapp_instances WHERE instance_name = '{{SLUG}}_bot';"
```

### 7. Предложить настроить AI бота
Спроси пользователя, хочет ли он настроить AI чатбота для автоответов.
Если да — выполни `skills/wa-bot-config/SKILL.md`.

## Результат
- WhatsApp инстанс создан и подключён
- Инстанс зарегистрирован в SaaS для обработки сообщений
- Готов к настройке AI бота
