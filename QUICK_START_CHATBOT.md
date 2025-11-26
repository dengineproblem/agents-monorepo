# ⚡ Быстрый старт: AI Chatbot Service

**5 минут до запуска!** 🚀

---

## ✅ Чек-лист

### 1️⃣ Создать .env.chatbot (1 мин)

```bash
# В корне проекта
cat > .env.chatbot << 'EOF'
PORT=8083
NODE_ENV=production
LOG_LEVEL=info

REDIS_URL=redis://redis-chatbot:6379
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=YOUR_EVOLUTION_KEY_HERE

SUPABASE_URL=YOUR_SUPABASE_URL
SUPABASE_SERVICE_ROLE=YOUR_SERVICE_ROLE_KEY

OPENAI_API_KEY=YOUR_OPENAI_KEY
EOF

# Открыть и заполнить
nano .env.chatbot
```

**Где взять ключи:**
- `EVOLUTION_API_KEY` - из `.env.agent`
- `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE` - из `.env.agent`
- `OPENAI_API_KEY` - из `.env.brain`

---

### 2️⃣ Применить миграции БД (2 мин)

```bash
# Запустить скрипт
chmod +x apply-chatbot-migrations.sh
./apply-chatbot-migrations.sh
```

**Или вручную** через Supabase Dashboard:
1. https://supabase.com/dashboard → SQL Editor
2. Выполнить `migrations/030_chatbot_fields.sql`
3. Выполнить `migrations/031_chatbot_configurations.sql`

---

### 3️⃣ Запустить сервисы (2 мин)

```bash
# Билд
docker-compose build chatbot-service chatbot-worker

# Запуск
docker-compose up -d redis-chatbot chatbot-service chatbot-worker

# Проверка
docker-compose ps | grep chatbot
docker-compose logs -f chatbot-service
```

**Ожидаемый вывод:**
```
redis-chatbot       Up (healthy)   6381/tcp
chatbot-service     Up             8083/tcp
chatbot-worker      Up
```

---

### 4️⃣ Проверить работу (30 сек)

```bash
# Health check
curl http://localhost:8083/health
# Ответ: {"ok":true,"service":"chatbot-service"}

# Redis очередь
docker exec -it redis-chatbot redis-cli
> PING
PONG
> KEYS *
(empty array)
> exit
```

---

### 5️⃣ Протестировать (1 мин)

**Отправить тестовое сообщение:**
1. Открыть WhatsApp
2. Написать на номер, подключенный через Evolution API
3. Отправить: "Здравствуйте"

**Проверить логи:**
```bash
# agent-service должен вызвать chatbot-service
docker-compose logs agent-service | grep "Sent message to chatbot-service"

# chatbot-service должен обработать
docker-compose logs chatbot-service | grep "process-message"

# Должен прийти автоответ бота
```

---

## 🛠️ Локальная разработка (опционально)

```bash
# Установить зависимости
cd services/chatbot-service
npm install

# Запустить dev режим
npm run dev

# В другом терминале - worker
npm run worker
```

**Переменные для локальной разработки:**
```bash
export REDIS_URL=redis://localhost:6381
export EVOLUTION_API_URL=http://localhost:8080
export SUPABASE_URL=https://ikywuvtavpnjlrjtalqi.supabase.co
export SUPABASE_SERVICE_ROLE=<from .env.agent>
export OPENAI_API_KEY=<from .env.brain>
```

---

## 🐛 Troubleshooting

### Ошибка: "Cannot connect to Redis"
```bash
# Проверить Redis запущен
docker-compose ps redis-chatbot

# Перезапустить
docker-compose restart redis-chatbot
```

### Ошибка: "Supabase credentials not configured"
```bash
# Проверить .env.chatbot
cat .env.chatbot | grep SUPABASE

# Перезапустить с новым .env
docker-compose restart chatbot-service
```

### Бот не отвечает
```bash
# Проверить логи
docker-compose logs -f chatbot-service | grep ERROR

# Проверить agent-service вызывает API
docker-compose logs agent-service | grep chatbot-service

# Проверить lead в БД
# Supabase Dashboard → Table Editor → dialog_analysis
# Найти lead по contact_phone
# Проверить bot_paused=false, assigned_to_human=false
```

### Redis очередь не работает
```bash
# Проверить worker запущен
docker-compose ps chatbot-worker

# Проверить логи worker
docker-compose logs -f chatbot-worker

# Перезапустить worker
docker-compose restart chatbot-worker
```

---

## 📚 Полная документация

- `CHATBOT_SERVICE_SEPARATION_COMPLETE.md` - детали архитектуры
- `CHATBOT_MVP_COMPLETE.md` - полное руководство
- `FINAL_STATUS_RU.md` - итоговый статус

---

## ✨ Готово!

chatbot-service запущен и готов к работе! 🎉

**API доступен на:**
- Internal: `http://chatbot-service:8083/process-message`
- Public: `http://localhost:8083/api/chatbot/*`

**Следующий шаг:** Интеграция с фронтендом (см. `CHATBOT_MVP_COMPLETE.md` → Frontend)







