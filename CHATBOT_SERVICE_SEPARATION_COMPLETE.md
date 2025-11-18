# ✅ Чат-бот вынесен в отдельный сервис

**Дата:** 9 ноября 2025  
**Статус:** Рефакторинг завершён - chatbot-service создан

---

## 🎯 Что сделано

Весь функционал AI чат-бота вынесен из `agent-service` в отдельный микросервис `chatbot-service`.

### Архитектура

```
┌──────────────┐
│   WhatsApp   │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│  Evolution API   │ (8080)
└──────┬───────────┘
       │ Webhook
       ▼
┌────────────────────────┐
│   agent-service (8082) │
│  evolutionWebhooks.ts  │
└────────┬───────────────┘
         │ HTTP API
         ▼
┌─────────────────────────────┐
│ chatbot-service (8083)      │
│  ┌─────────────────────┐    │
│  │ /process-message    │    │
│  └──────┬──────────────┘    │
│         │                    │
│         ▼                    │
│  ┌─────────────────────┐    │
│  │  chatbotEngine.ts   │    │
│  │  - shouldBotRespond │    │
│  │  - collectMessages  │    │
│  │  - generateResponse │    │
│  └─────┬───────────────┘    │
│        │                     │
│  ┌─────┴─────┐              │
│  │           │              │
│  ▼           ▼              │
│┌──────┐  ┌────────┐         │
││Redis │  │ GPT-4o │         │
││chatbot│ │  mini  │         │
│└──────┘  └────────┘         │
└─────────────────────────────┘
       │
       ▼
┌──────────────┐
│  Supabase    │
│  PostgreSQL  │
└──────────────┘
```

---

## 📦 Новый сервис: chatbot-service

### Структура

```
services/chatbot-service/
├── package.json                   ✅ Создан
├── tsconfig.json                  ✅ Создан
├── Dockerfile                     ✅ Создан
├── .env.example                   ✅ Создан
└── src/
    ├── server.ts                  ✅ Главный сервер (8083)
    ├── worker.ts                  ✅ Entry point для worker
    ├── lib/
    │   ├── supabase.ts            ✅ Supabase клиент
    │   ├── redis.ts               ✅ Redis клиент
    │   ├── chatbotEngine.ts       ✅ Движок бота
    │   ├── documentParser.ts      ✅ Парсинг документов
    │   ├── promptGenerator.ts     ✅ Генерация промптов
    │   └── reactivationEngine.ts  ✅ Система рассылок
    ├── routes/
    │   ├── chatbot.ts             ✅ API управления ботом
    │   ├── documents.ts           ✅ API документов
    │   └── reactivation.ts        ✅ API рассылок
    ├── cron/
    │   └── reactivationCron.ts    ✅ Cron задача (00:00)
    └── workers/
        └── reactivationWorker.ts  ✅ Worker рассылок
```

### Docker Compose

```yaml
chatbot-service:        # Порт 8083
  - /process-message    # Internal API для agent-service
  - /api/chatbot/*      # Public API для фронтенда
  - /api/chatbot/documents/*
  - /api/chatbot/reactivation/*

redis-chatbot:          # Порт 6381
  - Очереди сообщений
  - Реанимационные кампании

chatbot-worker:         # Без порта
  - Cron (00:00)
  - Worker (каждую минуту)
```

---

## 🔄 Изменения в agent-service

### Удалено

Файлы чат-бота удалены из `agent-service`:
```
✅ lib/redis.ts
✅ lib/chatbotEngine.ts
✅ lib/documentParser.ts
✅ lib/promptGenerator.ts
✅ lib/reactivationEngine.ts
✅ routes/chatbot.ts
✅ routes/documents.ts
✅ routes/reactivation.ts
✅ cron/reactivationCron.ts
✅ workers/reactivationWorker.ts
```

### Изменено

**`evolutionWebhooks.ts`**
- Убран импорт `chatbotEngine`
- Добавлен `CHATBOT_SERVICE_URL`
- `tryBotResponse()` теперь вызывает API `chatbot-service` вместо прямых функций

**`server.ts`**
- Убраны импорты чат-бота
- Убраны регистрации routes чат-бота
- Убраны cron/worker чат-бота

**Добавлено**
- `CHATBOT_SERVICE_URL=http://chatbot-service:8083` в environment

---

## 🚀 Запуск

### 1. Создать `.env.chatbot`

```bash
# Скопировать из примера
cp services/chatbot-service/.env.example .env.chatbot

# Заполнить:
PORT=8083
NODE_ENV=production
REDIS_URL=redis://redis-chatbot:6379
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=your-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE=your-service-role-key
OPENAI_API_KEY=your-openai-key
```

### 2. Применить миграции БД

(Если еще не применены)
```bash
# Supabase Dashboard → SQL Editor
# Выполнить migrations/030_chatbot_fields.sql
# Выполнить migrations/031_chatbot_configurations.sql
```

### 3. Локальный запуск

```bash
# Установить зависимости
cd services/chatbot-service
npm install

# Запустить в dev режиме
npm run dev

# В другом терминале - запустить worker
npm run worker
```

### 4. Production через Docker

```bash
# Билд
docker-compose build chatbot-service chatbot-worker

# Запуск
docker-compose up -d redis-chatbot chatbot-service chatbot-worker

# Проверка логов
docker-compose logs -f chatbot-service
docker-compose logs -f chatbot-worker

# Health check
curl http://localhost:8083/health
```

---

## 📡 API Endpoints

### Internal API (только для agent-service)

```
POST http://chatbot-service:8083/process-message
Body: {
  "contactPhone": "79001234567",
  "instanceName": "instance-name",
  "messageText": "Здравствуйте"
}
```

### Public API (для фронтенда через nginx)

```
# Управление ботом
POST   /api/chatbot/pause
POST   /api/chatbot/resume
POST   /api/chatbot/take-over
POST   /api/chatbot/return-to-bot
POST   /api/chatbot/send-follow-up
GET    /api/chatbot/status/:leadId

# Документы
POST   /api/chatbot/documents/upload
GET    /api/chatbot/configuration/:userAccountId
PUT    /api/chatbot/configuration/:configId
POST   /api/chatbot/regenerate-prompt

# Рассылки
GET    /api/chatbot/reactivation/status
POST   /api/chatbot/reactivation/start
GET    /api/chatbot/reactivation/queue
DELETE /api/chatbot/reactivation/cancel
```

---

## 🔧 Nginx конфигурация

Добавить в `nginx-production.conf` (если еще нет):

```nginx
# Chatbot Service API
location /api/chatbot/ {
    rewrite ^/api/chatbot/(.*)$ /$1 break;
    proxy_pass http://chatbot-service:8083;
    proxy_http_version 1.1;
    
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Таймауты
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;
    proxy_send_timeout 300s;
}
```

---

## ✅ Преимущества микросервисной архитектуры

### Изоляция
- ✅ Чат-бот не влияет на рекламные функции
- ✅ Падение одного сервиса не затрагивает другой

### Масштабирование
- ✅ Можно запустить 2+ инстанса chatbot-service
- ✅ Независимое масштабирование worker

### Разработка
- ✅ Отдельные логи и метрики
- ✅ Независимый деплой
- ✅ Можно тестировать изолированно

### Мониторинг
- ✅ Отдельный health check: `/health`
- ✅ Отдельные Grafana dashboards (если нужно)

---

## 🧪 Тестирование

### 1. Health Check

```bash
curl http://localhost:8083/health
# Response: {"ok":true,"service":"chatbot-service","timestamp":"..."}
```

### 2. Тест обработки сообщения

```bash
# Отправить сообщение на WhatsApp
# Проверить логи
docker-compose logs -f chatbot-service | grep "process-message"

# Должны увидеть:
# "Sent message to chatbot-service" (в agent-service)
# "Processing message" (в chatbot-service)
```

### 3. Тест рассылок

```bash
# Проверить worker запущен
docker-compose logs chatbot-worker | grep "started"

# Проверить Redis очередь
docker exec -it redis-chatbot redis-cli
> KEYS *
> ZRANGE reactivation_queue 0 -1 WITHSCORES
```

---

## 📝 Обновленные документы

Следующие файлы требуют обновления (TODO):
- `CHATBOT_MVP_COMPLETE.md` - обновить секцию "Запуск"
- `MVP_SUMMARY_RU.md` - обновить структуру
- `README.md` - добавить info о chatbot-service

---

## ✨ Готово к использованию

chatbot-service полностью вынесен в отдельный микросервис согласно плану!

**Следующий шаг:** Применить миграции → Создать .env.chatbot → Запустить 🚀





