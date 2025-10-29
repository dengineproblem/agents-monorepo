# Evolution API Deployment Guide

Это пошаговая инструкция для развертывания Evolution API интеграции с WhatsApp.

## ✅ Что было сделано

### Database Migrations
- ✅ `migrations/013_add_direction_creative_to_leads.sql` - добавлены поля для связи лидов с directions и креативами
- ✅ `migrations/014_create_whatsapp_instances_table.sql` - таблица для Evolution API instances
- ✅ `migrations/015_enhance_messages_table.sql` - улучшение таблицы сообщений
- ✅ `migrations/016_migrate_existing_leads_data.sql` - миграция существующих данных

### Docker Configuration
- ✅ `docker-compose.yml` - добавлены сервисы Evolution API, Redis, PostgreSQL
- ✅ `nginx-production.conf` - добавлен проксиing для `/evolution/`

### Backend (agent-service)
- ✅ `services/agent-service/src/routes/evolutionWebhooks.ts` - обработчик webhook от Evolution API
- ✅ `services/agent-service/src/routes/whatsappInstances.ts` - управление WhatsApp instances
- ✅ `services/agent-service/src/server.ts` - зарегистрированы новые роуты

---

## 🚀 Шаги развертывания

### Шаг 1: Подготовка окружения

1. **Сгенерируйте секретные ключи:**
   ```bash
   # Evolution API Key
   openssl rand -base64 32

   # PostgreSQL password
   openssl rand -base64 24
   ```

2. **Добавьте переменные в `.env.agent`:**
   ```bash
   # Evolution API Configuration
   EVOLUTION_API_KEY=<your-generated-key-here>
   EVOLUTION_DB_PASSWORD=<your-generated-password-here>
   EVOLUTION_SERVER_URL=https://app.performanteaiagency.com/evolution
   EVOLUTION_API_URL=http://evolution-api:8080
   ```

3. **Проверьте файл `.env.agent`:**
   ```bash
   cat .env.agent | grep EVOLUTION
   ```

### Шаг 2: Выполнение миграций базы данных

Подключитесь к вашей Supabase PostgreSQL и выполните миграции по порядку:

```bash
# Выполнить через Supabase SQL Editor или psql

# Migration 013
psql -h <your-db-host> -U postgres -d postgres -f migrations/013_add_direction_creative_to_leads.sql

# Migration 014
psql -h <your-db-host> -U postgres -d postgres -f migrations/014_create_whatsapp_instances_table.sql

# Migration 015
psql -h <your-db-host> -U postgres -d postgres -f migrations/015_enhance_messages_table.sql

# Migration 016 (миграция данных)
psql -h <your-db-host> -U postgres -d postgres -f migrations/016_migrate_existing_leads_data.sql
```

**Важно:** Migration 016 покажет статистику о мигрированных данных в виде NOTICE сообщений.

### Шаг 3: Запуск Docker контейнеров

1. **Остановите текущие контейнеры:**
   ```bash
   docker-compose down
   ```

2. **Соберите и запустите с новыми сервисами:**
   ```bash
   docker-compose up -d --build
   ```

3. **Проверьте логи Evolution API:**
   ```bash
   docker logs -f evolution-api
   ```

   Вы должны увидеть:
   ```
   ✔ Evolution API successfully configured
   ✔ Listening on http://0.0.0.0:8080
   ```

4. **Проверьте все контейнеры:**
   ```bash
   docker ps | grep evolution
   ```

   Должны быть запущены:
   - `evolution-api`
   - `evolution-redis`
   - `evolution-postgres`

### Шаг 4: Проверка nginx конфигурации

1. **Тест конфигурации nginx:**
   ```bash
   docker exec nginx nginx -t
   ```

2. **Перезагрузка nginx:**
   ```bash
   docker exec nginx nginx -s reload
   ```

3. **Проверка доступности Evolution API:**
   ```bash
   curl -H "apikey: YOUR_EVOLUTION_API_KEY" \
     https://app.performanteaiagency.com/evolution/instance/fetchInstances
   ```

   Ожидаемый ответ:
   ```json
   []
   ```
   (пустой массив, если instances еще не созданы)

### Шаг 5: Проверка backend

1. **Проверьте логи agent-service:**
   ```bash
   docker logs -f agent-service
   ```

   Должны увидеть при старте:
   ```
   Server listening at http://0.0.0.0:8082
   ```

2. **Тест webhook endpoint:**
   ```bash
   curl -X POST http://localhost:8082/api/webhooks/evolution \
     -H "Content-Type: application/json" \
     -d '{"event":"test"}'
   ```

   Ожидаемый ответ:
   ```json
   {"success":true}
   ```

3. **Тест instance management endpoint:**
   ```bash
   curl http://localhost:8082/api/whatsapp/instances?userAccountId=<some-uuid>
   ```

---

## 🧪 Тестирование системы

### Тест 1: Создание WhatsApp Instance

Через API или будущий frontend интерфейс:

```bash
curl -X POST http://localhost:8082/api/whatsapp/instances/create \
  -H "Content-Type: application/json" \
  -d '{"userAccountId":"<your-user-uuid>"}'
```

Ответ должен содержать QR код:
```json
{
  "success": true,
  "instance": {...},
  "qrcode": {
    "base64": "data:image/png;base64,..."
  }
}
```

### Тест 2: Подключение WhatsApp

1. Отсканируйте QR код в WhatsApp
2. Проверьте статус:
   ```bash
   curl http://localhost:8082/api/whatsapp/instances/<instance-name>/status
   ```

3. Статус должен измениться на `connected`

### Тест 3: Получение сообщения от рекламы

1. Запустите Facebook рекламу с WhatsApp целью
2. Кликните на рекламу и отправьте сообщение
3. Проверьте логи agent-service:
   ```bash
   docker logs agent-service | grep "Processing incoming WhatsApp message"
   ```

4. Проверьте создание лида:
   ```sql
   SELECT * FROM leads
   WHERE created_at > NOW() - INTERVAL '1 hour'
   ORDER BY created_at DESC
   LIMIT 5;
   ```

---

## 📊 Мониторинг

### Логи

```bash
# Evolution API
docker logs -f evolution-api

# Agent Service (webhook обработчик)
docker logs -f agent-service

# Redis
docker logs evolution-redis

# PostgreSQL
docker logs evolution-postgres
```

### Проверка состояния

```bash
# Количество подключенных instances
SELECT COUNT(*) FROM whatsapp_instances WHERE status = 'connected';

# Последние полученные сообщения
SELECT * FROM messages_ai_target
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

# Лиды с источником WhatsApp
SELECT COUNT(*) FROM leads
WHERE whatsapp_phone_number_id IS NOT NULL;

# Статистика по directions
SELECT
  d.name,
  COUNT(l.id) as leads_count,
  SUM(l.sale_amount) as total_revenue
FROM leads l
JOIN account_directions d ON l.direction_id = d.id
WHERE l.created_at > NOW() - INTERVAL '30 days'
GROUP BY d.name
ORDER BY leads_count DESC;
```

---

## ⚠️ Troubleshooting

### Evolution API не запускается

**Симптом:** `docker logs evolution-api` показывает ошибки

**Решение:**
1. Проверьте переменные окружения:
   ```bash
   docker exec evolution-api printenv | grep EVOLUTION
   ```

2. Проверьте подключение к PostgreSQL:
   ```bash
   docker exec evolution-api ping evolution-postgres
   ```

3. Проверьте подключение к Redis:
   ```bash
   docker exec evolution-api redis-cli -h evolution-redis ping
   ```

### Webhook не получает сообщения

**Симптом:** WhatsApp подключен, но лиды не создаются

**Решение:**
1. Проверьте webhook URL в Evolution API:
   ```bash
   curl -H "apikey: $EVOLUTION_API_KEY" \
     http://localhost:8080/webhook/find/global
   ```

2. Проверьте, что agent-service доступен из evolution-api:
   ```bash
   docker exec evolution-api curl http://agent-service:8082/health
   ```

3. Проверьте логи на ошибки:
   ```bash
   docker logs agent-service | grep ERROR
   ```

### QR код не отображается

**Симптом:** При создании instance QR код пустой

**Решение:**
1. Проверьте, что Evolution API может генерировать QR:
   ```bash
   curl -X POST -H "apikey: $EVOLUTION_API_KEY" \
     -H "Content-Type: application/json" \
     http://localhost:8080/instance/create \
     -d '{"instanceName":"test123","qrcode":true}'
   ```

2. Если проблема сохраняется, попробуйте обновить Evolution API:
   ```bash
   docker pull atendai/evolution-api:latest
   docker-compose up -d evolution-api
   ```

### Лиды не мапятся на креативы

**Симптом:** Лиды создаются, но `creative_id` = NULL

**Причина:** `source_id` (Ad ID) не найден в таблице `creative_tests` или `user_creatives`

**Решение:**
1. Проверьте, сохраняется ли `ad_id` при создании теста креатива
2. Добавьте логирование в `processAdLead`:
   ```typescript
   app.log.info({ sourceId, creativeId, directionId }, 'Creative mapping result');
   ```

3. Возможно потребуется сохранять `ad_id` при создании объявлений

---

## 🎯 Следующие шаги

После успешного деплоя backend, нужно:

1. ☐ **Frontend**: Создать страницу WhatsAppConnection.tsx для QR авторизации
2. ☐ **Frontend**: Обновить ROI Analytics для отображения по directions
3. ☐ **Frontend**: Обновить salesApi.ts для работы с direction_id
4. ☐ **Testing**: Протестировать с реальной Facebook рекламой
5. ☐ **Monitoring**: Настроить алерты в Grafana для ошибок webhook

---

## 📝 Полезные команды

```bash
# Перезапуск всех Evolution API сервисов
docker-compose restart evolution-api evolution-redis evolution-postgres

# Просмотр всех instances
curl -H "apikey: $EVOLUTION_API_KEY" http://localhost:8080/instance/fetchInstances

# Отключение instance
curl -X DELETE -H "apikey: $EVOLUTION_API_KEY" \
  http://localhost:8080/instance/logout/<instance-name>

# Резервное копирование Evolution DB
docker exec evolution-postgres pg_dump -U evolution evolution > evolution_backup.sql

# Восстановление Evolution DB
docker exec -i evolution-postgres psql -U evolution evolution < evolution_backup.sql
```

---

## 📚 Дополнительная документация

- [Evolution API Documentation](https://doc.evolution-api.com/)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)
- [Facebook Ads API](https://developers.facebook.com/docs/marketing-api)

---

## ✅ Чеклист успешного деплоя

- [ ] Миграции выполнены без ошибок
- [ ] Evolution API контейнер запущен и доступен
- [ ] Nginx проксирует /evolution/ на Evolution API
- [ ] Agent-service получает webhooks от Evolution API
- [ ] WhatsApp instance создается и показывает QR код
- [ ] WhatsApp подключается успешно (status = 'connected')
- [ ] Сообщения сохраняются в messages_ai_target
- [ ] Лиды с source_id создаются в таблице leads
- [ ] Лиды мапятся на креативы (creative_id заполняется)
- [ ] Лиды мапятся на directions (direction_id заполняется)

---

**Дата создания:** 2025-10-28
**Версия:** 1.0
**Автор:** Claude Code Assistant
