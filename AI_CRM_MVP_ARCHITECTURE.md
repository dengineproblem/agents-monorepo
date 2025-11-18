# AI-CRM MVP - Микросервисная архитектура

## Выбранная инфраструктура

### Новые микросервисы

**1. chatbot-service (порт 8083)**
- AI чат-бот engine (автоответы)
- Обработка входящих сообщений от Evolution API
- Генерация ответов через GPT (гибридная логика: правила + AI)
- Управление воронкой продаж
- API endpoints для фронтенда
- Загрузка документов + парсинг + генерация промпта

**2. redis-chatbot (порт 6381)**
- Очереди сообщений (склейка 5 сек)
- Очередь реанимационных рассылок (300/день)
- Кэш истории диалогов
- Rate limiting

**3. chatbot-worker (без внешнего порта)**
- Cron задачи (выбор 300 лидов ежедневно в 00:00)
- Воркер рассылок (каждую минуту проверяет очередь)
- Догоняющие сообщения (через 1 час)
- Мониторинг и логирование

## Схема взаимодействия

```
WhatsApp → Evolution API → POST /webhook/chatbot → chatbot-service
                                                           ↓
                                                   redis-chatbot (склейка 5 сек)
                                                           ↓
                                                   GPT → Ответ → Evolution API → WhatsApp
                                                           ↓
                                                   Supabase (обновление воронки)

chatbot-worker (cron 00:00) → Выбор 300 лидов → redis-chatbot (sorted set по timestamp)
                                                          ↓
                                                  chatbot-worker (каждую минуту)
                                                          ↓
                                                  GPT (персонализация) → Evolution API
```

## Docker Compose

```yaml
services:
  # Новый сервис: AI чат-бот
  chatbot-service:
    build: ./services/chatbot-service
    container_name: chatbot-service
    ports:
      - "8083:8083"
    environment:
      - NODE_ENV=production
      - PORT=8083
      - REDIS_CHATBOT_URL=redis://redis-chatbot:6379
      - EVOLUTION_API_URL=http://evolution-api:8080
      - EVOLUTION_API_KEY=${EVOLUTION_API_KEY}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - redis-chatbot
      - evolution-api
    networks:
      - agent-network
    restart: unless-stopped
  
  # Новый Redis для чат-бота
  redis-chatbot:
    image: redis:7-alpine
    container_name: redis-chatbot
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    ports:
      - "6381:6379"
    volumes:
      - redis-chatbot-data:/data
    networks:
      - agent-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3
  
  # Новый воркер для рассылок
  chatbot-worker:
    build: ./services/chatbot-service
    container_name: chatbot-worker
    command: npm run worker
    environment:
      - NODE_ENV=production
      - REDIS_CHATBOT_URL=redis://redis-chatbot:6379
      - EVOLUTION_API_URL=http://evolution-api:8080
      - EVOLUTION_API_KEY=${EVOLUTION_API_KEY}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - redis-chatbot
      - chatbot-service
    networks:
      - agent-network
    restart: unless-stopped

volumes:
  redis-chatbot-data:
    driver: local
```

## Nginx маршрутизация

```nginx
# В nginx.conf добавить:
upstream chatbot_service {
    server chatbot-service:8083;
}

# API endpoints
location /api/chatbot/ {
    proxy_pass http://chatbot_service/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}

# Webhook от Evolution API напрямую
location /webhook/chatbot {
    proxy_pass http://chatbot_service/webhook;
    proxy_http_version 1.1;
}
```

## Структура chatbot-service

```
services/chatbot-service/
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env.example
├── src/
│   ├── server.ts              # Fastify сервер (основной entry point)
│   ├── worker.ts              # Worker entry point (npm run worker)
│   ├── lib/
│   │   ├── chatbotEngine.ts   # Движок бота (shouldBotRespond, generateBotResponse)
│   │   ├── documentParser.ts  # Парсинг PDF/Excel/DOCX
│   │   ├── promptGenerator.ts # Генерация промпта из документов
│   │   ├── reactivationEngine.ts # Скоринг лидов (calculateReactivationScore)
│   │   ├── redis.ts           # Redis клиент (ioredis)
│   │   ├── supabase.ts        # Supabase клиент
│   │   └── evolution.ts       # Evolution API клиент
│   ├── routes/
│   │   ├── webhook.ts         # POST /webhook (от Evolution API)
│   │   ├── chatbot.ts         # POST /pause, /resume, /take-over
│   │   ├── documents.ts       # POST /upload-documents
│   │   └── reactivation.ts    # GET /reactivation/status, POST /reactivation/start
│   └── workers/
│       ├── reactivationCron.ts  # Cron: выбор 300 лидов (00:00)
│       └── reactivationWorker.ts # Отправка из очереди (каждую минуту)
```

## Преимущества микросервисной архитектуры

✅ **Изоляция**: чат-бот не влияет на рекламные функции (agent-service)
✅ **Масштабирование**: можно запустить 2+ инстанса chatbot-service
✅ **Надёжность**: если чат-бот упадёт, реклама продолжает работать
✅ **Мониторинг**: отдельные логи, метрики, алерты
✅ **Деплой**: независимое обновление без риска для основного функционала
✅ **Нагрузка**: отдельный Redis для очередей не забивает основную БД
✅ **Тестирование**: можно тестировать чат-бот изолированно

## Evolution API webhook настройка

При создании WhatsApp instance в Evolution API нужно настроить webhook:

```bash
POST http://evolution-api:8080/instance/create
{
  "instanceName": "performante-bot",
  "webhook": {
    "url": "http://chatbot-service:8083/webhook",
    "events": [
      "MESSAGES_UPSERT",
      "CONNECTION_UPDATE"
    ]
  }
}
```

## Данные в Supabase

Используем существующие таблицы:
- `dialog_analysis` - лиды + воронка + AI анализ
- `user_accounts` - пользователи
- `whatsapp_instances` - WhatsApp подключения

Добавляем новые:
- `chatbot_configurations` - настройки бота (промпты, триггеры, расписание)
- Новые поля в `dialog_analysis`:
  - `assigned_to_human` - менеджер взял в работу
  - `bot_paused` - бот на паузе
  - `last_bot_message_at` - последнее сообщение бота
  - `reactivation_attempts` - попытки реанимации

## Локальная разработка

```bash
# 1. Поднять Redis для чат-бота
docker-compose up -d redis-chatbot

# 2. Создать сервис
mkdir -p services/chatbot-service/src
cd services/chatbot-service
npm init -y
npm install fastify @fastify/cors @fastify/multipart
npm install @supabase/supabase-js ioredis openai
npm install pdf-parse xlsx mammoth node-cron
npm install -D typescript @types/node tsx

# 3. Запустить в dev режиме
npm run dev

# 4. В другом терминале запустить worker
npm run worker
```

## Production деплой

```bash
# 1. Коммит кода
git add services/chatbot-service
git commit -m "feat: chatbot-service MVP"
git push

# 2. На сервере
ssh root@server
cd ~/agents-monorepo

# 3. Обновить docker-compose.yml (добавить 3 новых сервиса)
nano docker-compose.yml

# 4. Билд и запуск
docker-compose build chatbot-service chatbot-worker
docker-compose up -d chatbot-service redis-chatbot chatbot-worker

# 5. Проверить логи
docker-compose logs -f chatbot-service
docker-compose logs -f chatbot-worker

# 6. Проверить здоровье Redis
docker exec -it redis-chatbot redis-cli ping
```

## Мониторинг

```bash
# Проверить очередь сообщений
docker exec -it redis-chatbot redis-cli
> KEYS pending_messages:*
> ZRANGE reactivation_queue 0 10 WITHSCORES

# Проверить статистику
curl http://localhost:8083/health
curl http://localhost:8083/api/chatbot/reactivation/status
```





