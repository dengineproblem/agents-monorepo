# Evolution API - Настройка и использование

## Обзор

Evolution API v2.3.6 интегрирован для обработки WhatsApp сообщений от Facebook Click-to-WhatsApp рекламы.

**Основные компоненты:**
- **Evolution API**: WhatsApp Business API на базе Baileys 7.0.0-rc.6
- **Manager UI**: Веб-интерфейс для управления инстансами
- **PostgreSQL**: Хранение данных инстансов и сообщений
- **Redis**: Кэш и очереди

## Доступ

- **API**: https://evolution.performanteaiagency.com/
- **Manager UI**: https://evolution.performanteaiagency.com/manager
- **API Key**: `52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1`

## Создание WhatsApp инстанса

### Через Manager UI

1. Открыть https://evolution.performanteaiagency.com/manager
2. Ввести API Key
3. Нажать "Create Instance"
4. Заполнить:
   - Instance Name: `whatsapp-main`
   - Integration: `WHATSAPP-BAILEYS`
   - Enable QR Code: `true`
5. Нажать "Generate QR Code"
6. Отсканировать QR-код в WhatsApp на телефоне:
   - Настройки → Связанные устройства → Связать устройство

### Через API

```bash
# Создать инстанс
curl -X POST https://evolution.performanteaiagency.com/instance/create \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "whatsapp-main",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true
  }'

# Получить QR-код
curl https://evolution.performanteaiagency.com/instance/connect/whatsapp-main \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1"
```

### Альтернатива: Pairing Code

Если QR-код не работает, используй pairing code:

```bash
# Создать инстанс БЕЗ QR
curl -X POST https://evolution.performanteaiagency.com/instance/create \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "whatsapp-main",
    "integration": "WHATSAPP-BAILEYS"
  }'

# Получить pairing code (замени номер на свой)
curl "https://evolution.performanteaiagency.com/instance/connect/whatsapp-main?number=77058151655" \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1"

# В ответе будет pairingCode: "ABC-DEF-123"
# Ввести код в WhatsApp: Настройки → Связанные устройства → Связать с номером телефона
```

## Управление инстансами

### Список инстансов

```bash
curl https://evolution.performanteaiagency.com/instance/fetchInstances \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1"
```

### Статус подключения

```bash
curl https://evolution.performanteaiagency.com/instance/connectionState/whatsapp-main \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1"
```

### Удалить инстанс

```bash
curl -X DELETE https://evolution.performanteaiagency.com/instance/delete/whatsapp-main \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1"
```

### Logout инстанса

```bash
curl -X DELETE https://evolution.performanteaiagency.com/instance/logout/whatsapp-main \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1"
```

## Webhooks

Evolution API автоматически отправляет события на:
```
http://agent-service:8082/api/webhooks/evolution
```

### Включенные события:

- `MESSAGES_UPSERT` - новые входящие сообщения
- `CONNECTION_UPDATE` - изменение статуса подключения
- `QRCODE_UPDATED` - обновление QR-кода

### Обработчик webhook

Код обработки находится в:
```
services/agent-service/src/routes/evolutionWebhooks.ts
```

Основная функция `processAdLead()`:
1. Извлекает `source_id` (Facebook Ad ID) из `messageContextInfo.stanzaId`
2. Находит creative по `ad_id` в таблице `creative_tests`
3. Создает лид в таблице `leads` с привязкой к `direction_id`, `creative_id`, `whatsapp_phone_number_id`

## Обновление Evolution API

### Проверка доступных версий

```bash
cd ~/evolution-api
git fetch --all --tags
git tag | grep "2\." | tail -10
```

### Обновление на новую версию

```bash
# 1. Переключиться на нужную версию
cd ~/evolution-api
git checkout 2.3.7
git submodule update --init --recursive

# 2. Собрать образ
docker build -t atendai/evolution-api:2.3.7 .

# 3. Обновить docker-compose.yml
cd ~/agents-monorepo
# Изменить: image: atendai/evolution-api:2.3.7

# 4. Перезапустить
docker-compose down evolution-api
docker-compose up -d evolution-api

# 5. Проверить версию
curl -s https://evolution.performanteaiagency.com/ | grep version
```

**ВАЖНО:**
- Docker Hub образы отстают от GitHub releases
- Всегда собирай из исходников для получения последних фиксов
- Инстансы и данные сохраняются при обновлении (volumes)

## Troubleshooting

### QR-код не генерируется

**Проблема**: `{"count": 0}` при запросе `/instance/connect`

**Решение**:
1. Проверь логи Baileys:
   ```bash
   docker logs evolution-api --tail 50 | grep -E "(QR|pairing|Connection Failure)"
   ```

2. Если видишь "Connection Failure" - используй pairing code вместо QR

3. Убедись что версия API >= 2.3.6 (с Baileys 7.0.0-rc.6)

### Инстанс отключается (status: close)

**Проблема**: Инстанс создается, но сразу переходит в `"connectionStatus": "close"`

**Решение**:
1. Проверь SERVER_URL в переменных окружения:
   ```bash
   docker exec evolution-api env | grep SERVER_URL
   # Должно быть: SERVER_URL=https://evolution.performanteaiagency.com
   ```

2. Проверь WebSocket в nginx (таймауты должны быть >= 3600s)

3. Пересоздай инстанс:
   ```bash
   curl -X DELETE https://evolution.performanteaiagency.com/instance/delete/INSTANCE_NAME \
     -H "apikey: API_KEY"

   # Создать заново
   ```

### Manager UI не загружается

**Проблема**: 404 на `/manager/` или ассеты не грузятся

**Решение**: Используй отдельный поддомен `https://evolution.performanteaiagency.com/manager`

Nginx уже настроен на проксирование всех запросов (включая Manager UI) на evolution-api:8080.

### Проверка подключения к WhatsApp

```bash
# Смотреть логи в реальном времени
docker logs -f evolution-api

# Должны быть строки:
# "msg":"connected to WA"
# "msg":"not logged in, attempting registration..."
# Без "Connection Failure"
```

## Переменные окружения

Все переменные в `docker-compose.yml`:

```yaml
SERVER_URL=https://evolution.performanteaiagency.com
AUTHENTICATION_API_KEY=${EVOLUTION_API_KEY}
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
CACHE_REDIS_ENABLED=true
WEBHOOK_GLOBAL_ENABLED=true
WEBHOOK_GLOBAL_URL=http://agent-service:8082/api/webhooks/evolution
WEBSOCKET_ENABLED=true
LOG_LEVEL=DEBUG
LOG_BAILEYS=debug
```

## Полезные ссылки

- **Документация**: https://doc.evolution-api.com/
- **GitHub**: https://github.com/EvolutionAPI/evolution-api
- **Postman коллекция**: https://www.postman.com/agenciadgcode/evolution-api/

---

**Дата создания**: 29 октября 2025
**Версия Evolution API**: 2.3.6 (Baileys 7.0.0-rc.6)
