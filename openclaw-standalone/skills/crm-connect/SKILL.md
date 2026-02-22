# CRM Connect — Подключение AmoCRM / Bitrix24

## Цель
Подключить CRM систему для синхронизации лидов и отслеживания воронки.

## Поддерживаемые CRM
- **AmoCRM** — OAuth 2.0 интеграция
- **Bitrix24** — Webhook интеграция

## AmoCRM

### 1. Получить OAuth данные
Попроси пользователя:
1. Открыть AmoCRM → Настройки → Интеграции
2. Создать приватную интеграцию (или использовать существующую)
3. Скопировать: **Client ID**, **Client Secret**, **Redirect URI**, **Authorization Code**
4. Указать **subdomain** (часть URL до `.amocrm.ru`)

### 2. Получить токены через OAuth
```bash
curl -s -X POST "https://{SUBDOMAIN}.amocrm.ru/oauth2/access_token" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "{CLIENT_ID}",
    "client_secret": "{CLIENT_SECRET}",
    "grant_type": "authorization_code",
    "code": "{AUTH_CODE}",
    "redirect_uri": "{REDIRECT_URI}"
  }'
```

### 3. Сохранить токены в config
```bash
psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -c "
  UPDATE config SET
    amocrm_subdomain = '{SUBDOMAIN}',
    amocrm_access_token = '{ACCESS_TOKEN}',
    amocrm_refresh_token = '{REFRESH_TOKEN}',
    amocrm_token_expires_at = NOW() + INTERVAL '{EXPIRES_IN} seconds',
    amocrm_client_id = '{CLIENT_ID}',
    amocrm_client_secret = '{CLIENT_SECRET}'
  WHERE id = 1;
"
```

### 4. Проверить подключение
```bash
curl -s "https://{SUBDOMAIN}.amocrm.ru/api/v4/account" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

### 5. Тестовая синхронизация лида
```bash
curl -s -X POST "https://{SUBDOMAIN}.amocrm.ru/api/v4/leads" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[{"name": "Тест OpenClaw", "pipeline_id": {PIPELINE_ID}}]'
```

---

## Bitrix24

### 1. Получить Webhook URL
Попроси пользователя:
1. Открыть Bitrix24 → Разработчикам → Другое → Входящий вебхук
2. Выбрать права: CRM, задачи
3. Скопировать URL вебхука

### 2. Извлечь токены из URL
URL формата: `https://domain.bitrix24.ru/rest/1/abc123def456/`
- domain = `domain.bitrix24.ru`
- access_token = `abc123def456`

### 3. Сохранить в config
```bash
psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -c "
  UPDATE config SET
    bitrix24_domain = '{DOMAIN}',
    bitrix24_access_token = '{TOKEN}',
    bitrix24_entity_type = 'deal',
    bitrix24_connected_at = NOW()
  WHERE id = 1;
"
```

### 4. Загрузить стадии воронки
```bash
# Получить воронки
curl -s "https://{DOMAIN}/rest/{TOKEN}/crm.dealcategory.list"

# Получить стадии
curl -s "https://{DOMAIN}/rest/{TOKEN}/crm.dealcategory.stage.list?id={CATEGORY_ID}"
```

Сохранить стадии:
```bash
psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -c "
  INSERT INTO bitrix24_pipeline_stages (category_id, category_name, status_id, status_name, status_sort, entity_type)
  VALUES ({CATEGORY_ID}, '{CATEGORY_NAME}', '{STATUS_ID}', '{STATUS_NAME}', {SORT}, 'deal')
  ON CONFLICT DO NOTHING;
"
```

### 5. Отметить стадии квалификации
Спроси пользователя, какие стадии считаются:
- **Квалифицированным лидом** (is_qualified_stage = true)
- **Успешной сделкой** (is_success_stage = true)
- **Отказом** (is_fail_stage = true)

```bash
psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -c "
  UPDATE bitrix24_pipeline_stages SET is_qualified_stage = true WHERE status_id = '{STATUS_ID}';
  UPDATE bitrix24_pipeline_stages SET is_success_stage = true WHERE status_id = '{STATUS_ID}';
"
```

### 6. Тестовая синхронизация
```bash
curl -s -X POST "https://{DOMAIN}/rest/{TOKEN}/crm.deal.add" \
  -H "Content-Type: application/json" \
  -d '{"fields": {"TITLE": "Тест OpenClaw", "CATEGORY_ID": {CATEGORY_ID}}}'
```

## Результат
- CRM подключена, токены сохранены в config
- Стадии воронки загружены (для Bitrix24)
- Лиды готовы к синхронизации
- Можно настроить CAPI через `wa-capi-setup/SKILL.md` с источником CRM
