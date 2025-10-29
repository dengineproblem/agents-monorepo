# 📱 Evolution API - Руководство по использованию

## 🎯 Обзор

Evolution API интегрирован в наш проект для автоматической обработки WhatsApp сообщений от Facebook рекламы и создания лидов с привязкой к креативам и направлениям.

---

## 🔗 API Endpoints

### Базовый URL
```
https://app.performanteaiagency.com/evolution
```

### API Key
```
52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1
```

---

## 📝 Основные операции

### 1. Создание WhatsApp инстанса

```bash
curl -X POST https://app.performanteaiagency.com/evolution/instance/create \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "whatsapp-main",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true
  }'
```

**Ответ:**
```json
{
  "instance": {
    "instanceName": "whatsapp-main",
    "instanceId": "uuid",
    "integration": "WHATSAPP-BAILEYS",
    "status": "connecting"
  },
  "qrcode": {"count": 0}
}
```

---

### 2. Получение QR-кода

Подождите 5-10 секунд после создания инстанса, затем:

```bash
curl https://app.performanteaiagency.com/evolution/instance/connect/whatsapp-main \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1"
```

**Ответ с QR-кодом:**
```json
{
  "count": 1,
  "pairingCode": null,
  "code": "1@ABC123...",
  "base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhE..."
}
```

---

### 3. Декодирование QR-кода

#### Вариант A: Онлайн конвертер
1. Скопируй значение `base64` из ответа
2. Открой: https://base64.guru/converter/decode/image
3. Вставь base64 строку
4. Скачай изображение
5. Отсканируй в WhatsApp

#### Вариант B: Сохранить локально (Linux/Mac)
```bash
# Получи QR и сохрани в файл
curl -s https://app.performanteaiagency.com/evolution/instance/connect/whatsapp-main \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1" \
  | jq -r '.base64' \
  | sed 's/data:image\/png;base64,//' \
  | base64 -d > qrcode.png

# Открой изображение
open qrcode.png  # Mac
xdg-open qrcode.png  # Linux
```

---

### 4. Проверка статуса инстанса

```bash
curl https://app.performanteaiagency.com/evolution/instance/fetchInstances \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1"
```

**Статусы:**
- `connecting` - ожидает подключения (нужно отсканировать QR)
- `open` - подключен и работает ✅
- `close` - отключен

---

### 5. Список всех инстансов

```bash
curl https://app.performanteaiagency.com/evolution/instance/fetchInstances \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1"
```

---

### 6. Удаление инстанса

```bash
curl -X DELETE https://app.performanteaiagency.com/evolution/instance/delete/whatsapp-main \
  -H "apikey: 52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1"
```

---

## 🔄 Как работает автоматическая обработка лидов

### Поток данных:

1. **Пользователь кликает на рекламу** в Facebook
2. **Открывается WhatsApp** с вашим номером
3. **Пользователь пишет сообщение**
4. **Evolution API получает webhook** с данными:
   - `message.key.remoteJid` - номер отправителя
   - `messageContextInfo.stanzaId` - **source_id** (Facebook Ad ID)
5. **Agent-service обрабатывает webhook** (`/api/webhooks/evolution`):
   - Извлекает `source_id` (Ad ID)
   - Находит креатив по `creative_tests.ad_id = source_id`
   - Получает `direction_id` из креатива
   - **Создает лид** в таблице `leads`:
     ```sql
     INSERT INTO leads (
       source_id,        -- Facebook Ad ID
       creative_id,      -- ID креатива
       direction_id,     -- ID направления
       whatsapp_phone_number_id,  -- WhatsApp номер
       user_account_id,  -- ID пользователя
       chat_id,          -- WhatsApp chat ID
       phone_number      -- Номер клиента
     ) VALUES (...)
     ```

### ROI Аналитика

Теперь можешь группировать лиды по `direction_id` и видеть:
- Сколько лидов пришло с каждого направления
- Какие креативы работают лучше
- ROI для каждого направления

**Пример SQL запроса:**
```sql
SELECT
  d.name as direction_name,
  COUNT(l.id) as total_leads,
  COUNT(p.id) as total_purchases,
  SUM(p.amount) as total_revenue
FROM leads l
LEFT JOIN account_directions d ON l.direction_id = d.id
LEFT JOIN purchases p ON l.id = p.lead_id
WHERE l.created_at >= '2025-01-01'
GROUP BY d.id, d.name
ORDER BY total_leads DESC;
```

---

## 🔧 Технические детали

### Webhook'и

Evolution API отправляет webhook'и на:
```
http://agent-service:8082/api/webhooks/evolution
```

**Обрабатываемые события:**
- `messages.upsert` - новое сообщение
- `connection.update` - изменение статуса подключения
- `qrcode.updated` - обновление QR-кода

### База данных

**Новые таблицы:**
- `whatsapp_instances` - WhatsApp инстансы
- Расширенные поля в `leads`:
  - `direction_id` - направление рекламы
  - `creative_id` - креатив
  - `whatsapp_phone_number_id` - номер WhatsApp
- Расширенные поля в `messages_ai_target`:
  - `source_id` - Facebook Ad ID
  - `instance_id` - WhatsApp инстанс
  - `raw_data` - полный webhook payload

---

## 🚨 Troubleshooting

### QR-код не генерируется (count остается 0)

**Причины:**
1. Инстанс еще инициализируется - подожди 10-15 секунд
2. Проблема с сетью в Docker контейнере
3. Evolution API не может подключиться к серверам WhatsApp

**Решение:**
```bash
# Проверь логи Evolution API
docker logs evolution-api --tail 50

# Если видишь ошибки "Timed Out" - перезапусти контейнер
docker restart evolution-api

# Подожди 30 секунд и попробуй снова
```

### Webhook'и не приходят

**Проверка:**
```bash
# Проверь логи agent-service
docker logs agents-monorepo-agent-service-1 --tail 100 | grep evolution

# Проверь что Evolution API видит agent-service
docker exec evolution-api curl http://agent-service:8082/health
```

### Лиды не создаются

**Проверка:**
1. Убедись что в `creative_tests` есть запись с `ad_id = source_id`
2. Проверь что креатив привязан к `direction_id`
3. Проверь логи agent-service на ошибки

---

## 📚 Документация

**Официальная документация Evolution API:**
- https://doc.evolution-api.com
- GitHub: https://github.com/EvolutionAPI/evolution-api

**Наша документация:**
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) - архитектура проекта
- [EVOLUTION_API_DEPLOYMENT.md](EVOLUTION_API_DEPLOYMENT.md) - инструкции по деплою
- [migrations/](migrations/) - SQL миграции для Evolution API

---

## ✅ Готово!

Evolution API настроен и готов к использованию! 🎉

Теперь все входящие сообщения от Facebook рекламы будут автоматически:
1. Обрабатываться через Evolution API
2. Извлекать source_id (Ad ID)
3. Находить креатив и направление
4. Создавать лид в базе данных
5. Доступны для ROI аналитики

**Поддержка:** Если возникли вопросы - проверь логи или обратись к [INFRASTRUCTURE.md](INFRASTRUCTURE.md)
