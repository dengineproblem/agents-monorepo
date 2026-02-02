# Moltbot Deployment Guide

## Обзор

Moltbot работает через **long polling** (а не webhook), поэтому **публичный домен НЕ НУЖЕН**.

Всё работает внутри Docker сети:
```
Telegram API ← → Moltbot Gateway (internal) ← → Agent Brain
```

## Быстрый деплой

```bash
# 1. Подключись к серверу
ssh your-server
cd ~/agents-monorepo

# 2. Подтяни изменения
git pull origin main

# 3. Настрой переменные окружения
bash setup-moltbot-env.sh

# Если есть недостающие переменные - добавь их:
nano .env.brain

# 4. Запусти Moltbot
docker-compose build moltbot
docker-compose up -d moltbot

# 5. Перезапусти nginx (применить обновлённую конфигурацию)
docker-compose restart nginx

# 6. Проверь логи
docker logs moltbot -f
```

## Что должно быть в .env.brain

```bash
# AI Providers (ОБЯЗАТЕЛЬНО - добавь вручную!)
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-api03-...

# Telegram Bot (ОБЯЗАТЕЛЬНО - добавь вручную!)
MOLTBOT_TELEGRAM_BOT_TOKEN=123456789:ABC...

# Долгосрочная память (опционально)
SUPERMEMORY_API_KEY=sm_...

# Внутренние сервисы (добавятся автоматически через скрипт)
AGENT_SERVICE_URL=http://agent-service:8082
MOLTBOT_TOKEN=moltbot-dev-token-2026
```

## Проверка работы

### 1. Логи контейнера
```bash
docker logs moltbot -f
```

**Ожидаемый вывод:**
```
✓ Telegram bot token injected
✓ Single-Workspace config ready: 1 router agent with 5 subagents (facebook-ads, creatives, crm, tiktok, onboarding)
✓ Auth profile configured for router agent
[router] agent model: openai/gpt-5.2
Telegram channel enabled
Gateway listening on 0.0.0.0:18789
```

### 2. Проверка сетевой связности
```bash
# Agent-brain должен видеть moltbot
docker exec agent-brain ping -c 3 moltbot

# Проверка порта
docker exec agent-brain nc -zv moltbot 18789
```

### 3. Telegram бот
1. Открой Telegram
2. Найди своего бота
3. Отправь `/start`
4. Напиши "Привет"
5. Бот должен ответить

## Troubleshooting

### Бот не отвечает

```bash
# 1. Проверь что контейнер запущен
docker ps | grep moltbot

# 2. Логи
docker logs moltbot --tail 100

# 3. Проверь env переменные
docker exec moltbot env | grep MOLTBOT_TELEGRAM_BOT_TOKEN

# 4. Проверь конфигурацию
docker exec moltbot cat /root/.moltbot/moltbot.json | grep -A 5 telegram

# 5. Удали webhook (если был настроен ранее)
curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"

# 6. Перезапусти
docker-compose restart moltbot
```

### Agent-brain не видит moltbot

```bash
# Проверь что оба в одной сети
docker network inspect agents-monorepo_default | grep -A 5 "moltbot\|agent-brain"

# Проверь docker-compose.yml - depends_on
grep -A 5 "depends_on:" docker-compose.yml | grep moltbot
```

### Ошибка "webhook already set"

```bash
# Telegram бот настроен на webhook - переключи на polling
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/deleteWebhook"
docker-compose restart moltbot
```

## Мониторинг

```bash
# Логи в реальном времени
docker logs moltbot -f

# Ресурсы
docker stats moltbot

# Количество активных соединений
docker exec moltbot netstat -an | grep 18789
```

## Обновление

```bash
# Обновление кода
cd ~/agents-monorepo
git pull origin main

# Пересборка образа
docker-compose build moltbot

# Перезапуск (с сохранением данных)
docker-compose up -d moltbot

# Проверка логов
docker logs moltbot -f
```

## Публичный доступ (если понадобится)

Если в будущем нужен публичный домен (например, для webhook или API доступа):

1. Раскомментируй секцию `MOLTBOT TELEGRAM GATEWAY` в [nginx-production.conf](nginx-production.conf)
2. Создай SSL сертификат:
   ```bash
   docker-compose stop nginx
   certbot certonly --standalone -d moltbot.performanteaiagency.com
   docker-compose up -d nginx
   ```
3. Добавь DNS запись `moltbot.performanteaiagency.com` → IP сервера

## Архитектура

**Single-Workspace Architecture:**
- 1 Router агент обслуживает ВСЕХ пользователей
- Изоляция пользователей через Telegram Chat ID → userAccountId
- Router содержит 5 встроенных ролей (subagents): facebook-ads, creatives, crm, tiktok, onboarding

```
┌─────────────────────────────────────────┐
│ Telegram API (external)                 │
└─────────────┬───────────────────────────┘
              │ long polling
              ▼
┌─────────────────────────────────────────┐
│ Moltbot Gateway (moltbot:18789)         │
│ - Telegram transport                    │
│ - Single router agent                   │
│ - Session isolation (Chat ID → UUID)    │
│ - Auth profiles                         │
└─────────────┬───────────────────────────┘
              │ HTTP tools (AGENT_SERVICE_URL)
              ▼
┌─────────────────────────────────────────┐
│ Agent Service (agent-service:8082)      │
│ - Facebook Ads API                      │
│ - Creative generation                   │
│ - CRM & Leads                           │
│ - Database access                       │
└─────────────────────────────────────────┘

Router Subagents:
├─ facebook-ads   (Facebook/Instagram управление)
├─ creatives      (Генерация креативов)
├─ crm            (Лиды и продажи)
├─ tiktok         (TikTok управление)
└─ onboarding     (Регистрация пользователей)
```

## Порты

| Сервис | Внутренний порт | Внешний порт | Публичный доступ |
|--------|----------------|--------------|------------------|
| moltbot | 18789 | - | ❌ Не нужен |
| agent-brain | 7080 | 7080 | ⚠️ Только для LLM |
| agent-service | 8082 | 8082 | ✅ Через Nginx |

## Безопасность

- ✅ Все секреты в `.env.brain` (не в git)
- ✅ Права доступа: `chmod 600 .env.brain`
- ✅ Moltbot работает только в Docker сети
- ✅ Нет публичного доступа к gateway
- ✅ Telegram bot через long polling (не webhook)

## Логи и отладка

Важные лог-паттерны:

```bash
# Успешный запуск
docker logs moltbot 2>&1 | grep "Telegram channel enabled"

# Проблемы с токеном
docker logs moltbot 2>&1 | grep -i "token\|auth"

# WebSocket соединения
docker logs moltbot 2>&1 | grep -i "websocket\|ws:"

# Вызовы инструментов
docker logs moltbot 2>&1 | grep -i "tool\|curl"
```
