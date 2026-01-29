# Moltbot Telegram Integration

Подробная документация по интеграции AI-ассистента через Telegram с использованием Moltbot.

## Содержание

1. [Обзор архитектуры](#обзор-архитектуры)
2. [Компоненты системы](#компоненты-системы)
3. [Конфигурация](#конфигурация)
4. [Skills (Навыки)](#skills-навыки)
5. [Аутентификация и Auth Profiles](#аутентификация-и-auth-profiles)
6. [Prompt Caching](#prompt-caching)
7. [Контекст пользователя](#контекст-пользователя)
8. [Работа с инструментами (Tools)](#работа-с-инструментами-tools)
9. [Голосовые сообщения](#голосовые-сообщения)
10. [Docker конфигурация](#docker-конфигурация)
11. [Мониторинг и логи](#мониторинг-и-логи)
12. [Troubleshooting](#troubleshooting)
13. [Команды управления](#команды-управления)

---

## Обзор архитектуры

### Схема потока данных

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TELEGRAM USER                                 │
│                             │                                        │
│                             ▼                                        │
│                    Telegram Bot API                                  │
│                             │                                        │
│                             ▼                                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      MOLTBOT GATEWAY                          │   │
│  │                     (порт 18789)                              │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │   │
│  │  │  Telegram   │  │   Claude    │  │    Skills Engine    │   │   │
│  │  │  Transport  │  │   Sonnet    │  │   (AGENTS.md,       │   │   │
│  │  │             │  │    4.5      │  │    TOOLS.md, etc)   │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │   │
│  │  │   Whisper   │  │   Prompt    │  │   Auth Profiles     │   │   │
│  │  │   (Audio)   │  │   Caching   │  │   (API Keys)        │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                             │                                        │
│                             ▼                                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     AGENT-BRAIN                               │   │
│  │                     (порт 7080)                               │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │   │
│  │  │ /api/context│  │ /brain/tools│  │    Supabase DB      │   │   │
│  │  │             │  │  /:toolName │  │                     │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                             │                                        │
│                             ▼                                        │
│                    Facebook Marketing API                            │
│                    TikTok Marketing API                              │
└─────────────────────────────────────────────────────────────────────┘
```

### Принцип работы

1. **Пользователь** отправляет сообщение в Telegram бот
2. **Moltbot** получает сообщение через Telegram Transport
3. **Claude Sonnet 4.5** обрабатывает запрос, используя Skills
4. **Claude** вызывает инструменты через HTTP к agent-brain
5. **Agent-brain** выполняет запросы к Facebook/TikTok API
6. **Результат** возвращается пользователю в Telegram

---

## Компоненты системы

### Moltbot Gateway

**Moltbot** — это Gateway для Claude, который предоставляет:

| Функция | Описание |
|---------|----------|
| **Telegram Transport** | Приём/отправка сообщений через Telegram Bot API |
| **Skills Engine** | Загрузка инструкций из markdown файлов |
| **Auth Profiles** | Управление API ключами для разных провайдеров |
| **Prompt Caching** | Кэширование системных промптов (экономия ~90% токенов) |
| **Audio Transcription** | Расшифровка голосовых через Whisper |
| **Session Management** | Управление сессиями пользователей |

### Agent-Brain

**Agent-brain** — HTTP API сервер, предоставляющий:

| Endpoint | Назначение |
|----------|------------|
| `GET /api/context` | Получение credentials по Telegram ID |
| `POST /brain/tools/:name` | Выполнение инструментов (70+ tools) |
| `GET /health` | Health check |

### Volumes и файлы

```
moltbot-workspace/                 # Volume монтируется в /root/clawd
├── AGENTS.md                     # Главные инструкции для Claude
├── TOOLS.md                      # Описание формата вызова tools
├── IDENTITY.md                   # Идентичность бота
├── SOUL.md                       # "Душа" бота (стиль общения)
├── USER.md                       # Информация о пользователе
├── HEARTBEAT.md                  # Периодические задачи
└── skills/                       # Навыки (skills)
    ├── context/
    │   └── SKILL.md              # Получение контекста
    ├── facebook-ads/
    │   └── SKILL.md              # Facebook Ads tools
    ├── creatives/
    │   └── SKILL.md              # Креативы
    ├── crm/
    │   └── SKILL.md              # CRM и лиды
    └── tiktok/
        └── SKILL.md              # TikTok Ads
```

---

## Конфигурация

### Основной конфиг: moltbot.json

Расположение в контейнере: `/root/.clawdbot/moltbot.json`

```json
{
  "meta": {
    "lastTouchedVersion": "2026.1.27-beta.1",
    "lastTouchedAt": "2026-01-29T14:06:17.375Z"
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-20250514"
      },
      "models": {
        "anthropic/claude-sonnet-4-20250514": {
          "params": {
            "cacheControlTtl": "1h"
          },
          "alias": "claude"
        },
        "openai/gpt-5.2": {
          "alias": "gpt"
        }
      },
      "contextPruning": {
        "mode": "cache-ttl",
        "ttl": "1h"
      },
      "compaction": {
        "mode": "safeguard"
      },
      "heartbeat": {
        "every": "30m"
      },
      "maxConcurrent": 4,
      "subagents": {
        "maxConcurrent": 8
      }
    }
  },
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "models": [
          {
            "provider": "openai",
            "model": "whisper-1",
            "baseUrl": "https://api.openai.com/v1"
          }
        ]
      }
    }
  },
  "messages": {
    "ackReactionScope": "group-mentions"
  },
  "commands": {
    "native": "auto",
    "nativeSkills": "auto"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "dmPolicy": "open",
      "botToken": "YOUR_TELEGRAM_BOT_TOKEN",
      "allowFrom": ["*"],
      "groupPolicy": "allowlist",
      "streamMode": "partial"
    }
  },
  "gateway": {
    "mode": "local",
    "auth": {
      "token": "moltbot-dev-token-2026"
    }
  },
  "plugins": {
    "entries": {
      "telegram": {
        "enabled": true
      }
    }
  }
}
```

### Параметры конфигурации

#### agents.defaults.model

| Параметр | Тип | Описание |
|----------|-----|----------|
| `primary` | string | Основная модель (например `anthropic/claude-sonnet-4-20250514`) |

#### agents.defaults.models

| Параметр | Тип | Описание |
|----------|-----|----------|
| `params.cacheControlTtl` | string | TTL для prompt caching (`1h`, `30m`, etc) |
| `alias` | string | Короткое имя для переключения (`/model claude`) |

#### channels.telegram

| Параметр | Тип | Описание |
|----------|-----|----------|
| `enabled` | boolean | Включить Telegram транспорт |
| `dmPolicy` | string | Политика DM: `open` / `allowlist` |
| `botToken` | string | Токен Telegram бота |
| `allowFrom` | array | Список разрешённых chat_id (`["*"]` = все) |
| `groupPolicy` | string | Политика групп: `open` / `allowlist` |
| `streamMode` | string | Режим стриминга: `partial` / `full` / `none` |

#### tools.media.audio

| Параметр | Тип | Описание |
|----------|-----|----------|
| `enabled` | boolean | Включить расшифровку аудио |
| `models` | array | Список моделей для транскрипции |

---

## Skills (Навыки)

### Что такое Skill?

**Skill** — это markdown-файл с инструкциями для Claude. При запуске Moltbot загружает все skills как часть системного промпта.

### Структура Skill файла

```markdown
---
name: facebook-ads
description: Управление Facebook/Instagram рекламой через API
requires:
  env:
    - AGENT_SERVICE_URL
---

# Facebook Ads Skill

Описание skill...

## READ Tools (Чтение данных)

### getCampaigns
Получить список кампаний с метриками.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getCampaigns \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "UUID",
    "accountId": "UUID",
    "period": "last_7d"
  }'
```

## WRITE Tools (Изменение данных)

**ВАЖНО**: Перед WRITE операциями запроси подтверждение!

### pauseAdSet
...
```

### Список доступных Skills

| Skill | Файл | Описание | Tools |
|-------|------|----------|-------|
| **context** | `skills/context/SKILL.md` | Получение контекста пользователя | 1 |
| **facebook-ads** | `skills/facebook-ads/SKILL.md` | Facebook/Instagram реклама | 24 |
| **creatives** | `skills/creatives/SKILL.md` | Генерация и анализ креативов | 23 |
| **crm** | `skills/crm/SKILL.md` | CRM, лиды, воронка | 18 |
| **tiktok** | `skills/tiktok/SKILL.md` | TikTok реклама | 18 |

### Как Claude использует Skills

1. При старте Moltbot загружает все `.md` файлы из `moltbot-workspace/`
2. Claude получает их как часть системного промпта
3. Когда пользователь спрашивает "покажи статистику", Claude:
   - Понимает что нужно `getCampaigns`
   - Смотрит в skills как вызвать этот tool
   - Выполняет curl команду
   - Форматирует ответ

---

## Аутентификация и Auth Profiles

### Расположение

Файл: `/root/.clawdbot/agents/main/agent/auth-profiles.json`

### Формат

```json
{
  "profiles": [
    {
      "id": "anthropic",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-...",
      "default": true
    },
    {
      "id": "openai",
      "provider": "openai",
      "apiKey": "sk-proj-..."
    }
  ]
}
```

### Параметры профиля

| Параметр | Тип | Описание |
|----------|-----|----------|
| `id` | string | Уникальный ID профиля |
| `provider` | string | Провайдер: `anthropic`, `openai`, `google` |
| `apiKey` | string | API ключ |
| `default` | boolean | Использовать по умолчанию |
| `model` | string | (опционально) Модель по умолчанию для этого профиля |

### Типы токенов Anthropic

| Префикс | Тип | Использование |
|---------|-----|---------------|
| `sk-ant-api03-...` | API Key | SDK, API вызовы, Moltbot |
| `sk-ant-oat01-...` | OAuth Token | Claude Code CLI, claude.ai |

**Важно:** OAuth токены от Max подписки НЕ работают для API вызовов. Для Moltbot нужен API ключ.

### Команды управления профилями

```bash
# Просмотр профилей
docker exec moltbot moltbot models auth

# Добавить токен интерактивно
docker exec -it moltbot moltbot models auth add

# Вставить токен (требует TTY для подтверждения)
docker exec -it moltbot moltbot models auth paste-token --provider anthropic
```

### Ручная настройка (без TTY)

```bash
docker exec moltbot sh -c 'cat > /root/.clawdbot/agents/main/agent/auth-profiles.json << EOF
{
  "profiles": [
    {
      "id": "anthropic",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-YOUR_KEY",
      "default": true
    }
  ]
}
EOF'

# Применить изменения
docker kill --signal=USR1 moltbot
```

---

## Prompt Caching

### Что это?

**Prompt Caching** — технология Anthropic, которая кэширует системные промпты на серверах Claude. При повторных запросах кэшированная часть не пересылается, что экономит до 90% токенов.

### Как включить

В `moltbot.json`:

```json
{
  "agents": {
    "defaults": {
      "models": {
        "anthropic/claude-sonnet-4-20250514": {
          "params": {
            "cacheControlTtl": "1h"
          }
        }
      }
    }
  }
}
```

### Значения TTL

| Значение | Описание |
|----------|----------|
| `5m` | 5 минут (минимум) |
| `1h` | 1 час (рекомендуется) |
| `24h` | 24 часа (максимум) |

### Проверка в логах

```bash
docker logs moltbot 2>&1 | grep -i cache
```

Должно показать:
```
creating streamFn wrapper with params: {"cacheControlTtl":"1h"}
```

### Экономия

| Сценарий | Без кэширования | С кэшированием |
|----------|-----------------|----------------|
| Системный промпт | ~15,000 токенов | ~1,500 токенов (cached read) |
| Стоимость | $0.045 | $0.00225 |
| **Экономия** | — | **95%** |

---

## Контекст пользователя

### Зачем нужен контекст?

Для выполнения операций с рекламой нужно знать:
- **userAccountId** — кто пользователь в системе (UUID)
- **accountId** — какой рекламный аккаунт выбран (UUID)
- **accessToken** — токен для Facebook API (автоматически)

### Как Moltbot передаёт контекст

Moltbot автоматически добавляет в начало каждого сообщения:

```
[Telegram Chat ID: 123456789]

Текст сообщения пользователя
```

### Endpoint /api/context

Claude вызывает этот endpoint в начале диалога:

```bash
curl -s http://agent-brain:7080/api/context \
  -H "X-Telegram-Id: 123456789"
```

**Ответ:**
```json
{
  "userAccountId": "uuid-of-user",
  "accountId": "uuid-of-ad-account",
  "accessToken": "EAA...",
  "adAccountId": "act_123456"
}
```

### Привязка Telegram ID

Пользователь должен привязать свой Telegram к аккаунту через веб-интерфейс:
1. Зайти в Настройки → Профиль
2. Нажать "Привязать Telegram"
3. Ввести свой Telegram ID (можно узнать через @userinfobot)

В базе данных это поле `telegram_id` в таблице `user_accounts`.

### Multi-Account режим

Если у пользователя несколько рекламных аккаунтов:

```json
{
  "userAccountId": "uuid-user",
  "accountId": "uuid-selected-ad-account",  // Активный аккаунт
  "accessToken": "EAA...",
  "adAccountId": "act_123"
}
```

Активный аккаунт определяется полем `is_active = true` в таблице `ad_accounts`.

---

## Работа с инструментами (Tools)

### Формат вызова

Claude вызывает tools через curl:

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/{toolName} \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "uuid-from-context",
    "accountId": "uuid-from-context",
    "param1": "value1",
    "param2": "value2"
  }'
```

### Обязательные параметры

| Параметр | Описание |
|----------|----------|
| `userAccountId` | UUID пользователя из контекста |
| `accountId` | UUID рекламного аккаунта (для multi-account) |

### Категории инструментов

#### Facebook Ads (24 tools)

| Tool | Тип | Описание |
|------|-----|----------|
| `getCampaigns` | READ | Список кампаний с метриками |
| `getCampaignDetails` | READ | Детали кампании |
| `getAdSets` | READ | Адсеты кампании |
| `getAds` | READ | Объявления |
| `pauseAdSet` | WRITE | Пауза адсета |
| `resumeAdSet` | WRITE | Возобновление адсета |
| `updateBudget` | WRITE | Изменение бюджета |

#### Креативы (23 tools)

| Tool | Тип | Описание |
|------|-----|----------|
| `getCreatives` | READ | Список креативов |
| `getTopCreatives` | READ | Лучшие креативы |
| `generateCreatives` | WRITE | Генерация изображений |
| `launchCreative` | WRITE | Запуск в рекламу |

#### CRM (18 tools)

| Tool | Тип | Описание |
|------|-----|----------|
| `getLeads` | READ | Список лидов |
| `getDialogs` | READ | WhatsApp диалоги |
| `updateLeadStage` | WRITE | Изменение стадии |

#### TikTok (18 tools)

| Tool | Тип | Описание |
|------|-----|----------|
| `getTikTokCampaigns` | READ | Кампании TikTok |
| `pauseTikTokAdGroup` | WRITE | Пауза группы объявлений |

### Опасные операции

WRITE операции требуют подтверждения пользователя:

```
Claude: Хотите поставить на паузу адсет "Ретаргетинг" (ID: 123)?
User: Да
Claude: [выполняет pauseAdSet]
```

---

## Голосовые сообщения

### Как это работает

1. Пользователь отправляет голосовое сообщение в Telegram
2. Moltbot получает аудио файл
3. Отправляет на OpenAI Whisper API для транскрипции
4. Claude обрабатывает текст как обычное сообщение

### Конфигурация Whisper

В `moltbot.json`:

```json
{
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "models": [
          {
            "provider": "openai",
            "model": "whisper-1",
            "baseUrl": "https://api.openai.com/v1"
          }
        ]
      }
    }
  }
}
```

### Требования

- OpenAI API ключ в auth-profiles.json
- Достаточный баланс на OpenAI аккаунте
- Аудио формат: ogg/opus (Telegram default)

### Troubleshooting аудио

Если голосовые не работают:

```bash
# Проверить конфиг
docker exec moltbot cat /root/.clawdbot/moltbot.json | jq '.tools.media.audio'

# Проверить OpenAI ключ
docker exec moltbot cat /root/.clawdbot/agents/main/agent/auth-profiles.json | jq '.profiles[] | select(.provider=="openai")'

# Проверить логи
docker logs moltbot 2>&1 | grep -i "audio\|whisper\|transcri"
```

---

## Docker конфигурация

### docker-compose.yml

```yaml
moltbot:
  image: node:22-slim
  container_name: moltbot
  working_dir: /root/clawd
  env_file:
    - ./.env.brain
  command:
    - sh
    - -c
    - |
      apt-get update && apt-get install -y git ca-certificates python3 make g++ curl
      git config --global url."https://github.com/".insteadOf ssh://git@github.com/
      git config --global url."https://github.com/".insteadOf git@github.com:
      npm install -g moltbot@beta
      moltbot gateway --bind lan --token "moltbot-dev-token-2026"
  environment:
    - OPENAI_API_KEY=${OPENAI_API_KEY}
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    - AGENT_SERVICE_URL=http://agent-brain:7080
  volumes:
    - ./moltbot-workspace:/root/clawd
    - moltbot-data:/root/.clawdbot
  ports:
    - "18789:18789"
  networks:
    - app-network
  restart: unless-stopped

volumes:
  moltbot-data:
    name: moltbot-data
```

### Переменные окружения (.env.brain)

```bash
# OpenAI для Whisper
OPENAI_API_KEY=sk-proj-...

# Anthropic для Claude
ANTHROPIC_API_KEY=sk-ant-api03-...

# Telegram бот
MOLTBOT_TELEGRAM_BOT_TOKEN=123456:ABC...

# Agent-brain URL
AGENT_SERVICE_URL=http://agent-brain:7080
```

### Volumes

| Volume | Путь в контейнере | Описание |
|--------|-------------------|----------|
| `./moltbot-workspace` | `/root/clawd` | Skills, AGENTS.md и др. |
| `moltbot-data` | `/root/.clawdbot` | Конфиги, auth-profiles, логи |

**Важно:** `moltbot-data` — named volume, сохраняется между рестартами. Без него auth-profiles.json будет сбрасываться.

---

## Мониторинг и логи

### Просмотр логов

```bash
# Последние 100 строк
docker logs moltbot --tail 100

# Follow mode
docker logs moltbot -f

# С timestamp
docker logs moltbot -t

# За последнюю минуту
docker logs moltbot --since 1m
```

### Ключевые события в логах

| Паттерн | Значение |
|---------|----------|
| `[gateway] agent model:` | Какая модель используется |
| `[telegram] starting provider` | Telegram бот запущен |
| `[agent/embedded] embedded run start` | Начало обработки сообщения |
| `[agent/embedded] embedded run done` | Завершение обработки |
| `creating streamFn wrapper with params` | Параметры (включая caching) |
| `Auth profiles configured` | Какие профили загружены |

### Файл логов

```bash
# Путь к файлу логов внутри контейнера
docker exec moltbot cat /tmp/moltbot/moltbot-$(date +%Y-%m-%d).log
```

### Health check

```bash
# Статус контейнера
docker ps --filter name=moltbot

# Health события в логах
docker logs moltbot 2>&1 | grep -i health
```

---

## Troubleshooting

### Бот не отвечает

1. **Проверить статус контейнера:**
   ```bash
   docker ps --filter name=moltbot
   ```

2. **Проверить Telegram подключение:**
   ```bash
   docker logs moltbot 2>&1 | grep -i telegram
   ```
   Должно быть: `[telegram] [default] starting provider (@BotName)`

3. **Проверить API ключи:**
   ```bash
   docker exec moltbot cat /root/.clawdbot/agents/main/agent/auth-profiles.json
   ```

### Ошибки аутентификации

```
Error: Authentication failed
```

**Решение:**
1. Проверить что API ключ правильный
2. Убедиться что ключ не OAuth токен (sk-ant-oat01-)
3. Перезаписать auth-profiles.json и перезагрузить

### Контекст не найден

```
{"error": "User not found"}
```

**Решение:**
1. Пользователь должен привязать Telegram ID в веб-интерфейсе
2. Проверить что telegram_id записан в базу:
   ```sql
   SELECT id, telegram_id FROM user_accounts WHERE telegram_id IS NOT NULL;
   ```

### Tools не работают

```
Error: Connection refused to agent-brain
```

**Решение:**
1. Проверить что agent-brain запущен:
   ```bash
   docker ps --filter name=agent-brain
   ```
2. Проверить сеть Docker:
   ```bash
   docker network inspect app-network
   ```
3. Проверить что оба контейнера в одной сети

### Prompt caching не работает

**Проверить:**
```bash
docker logs moltbot 2>&1 | grep -i cache
```

**Должно быть:**
```
creating streamFn wrapper with params: {"cacheControlTtl":"1h"}
```

**Если нет — проверить конфиг:**
```bash
docker exec moltbot cat /root/.clawdbot/moltbot.json | jq '.agents.defaults.models'
```

### Сброс конфигурации после рестарта

**Проблема:** auth-profiles.json сбрасывается

**Причина:** Volume не персистентный

**Решение:** Использовать named volume:
```yaml
volumes:
  - moltbot-data:/root/.clawdbot

volumes:
  moltbot-data:
    name: moltbot-data
```

---

## Команды управления

### Перезагрузка конфигурации

```bash
# Soft reload (применяет изменения без рестарта)
docker kill --signal=USR1 moltbot
```

### Полный рестарт

```bash
docker restart moltbot
```

### Смена модели

```bash
# Через CLI (требует TTY)
docker exec -it moltbot moltbot models set anthropic/claude-sonnet-4-20250514

# Или редактированием moltbot.json
docker exec moltbot sh -c 'jq ".agents.defaults.model.primary = \"anthropic/claude-sonnet-4-20250514\"" /root/.clawdbot/moltbot.json > /tmp/moltbot.json && mv /tmp/moltbot.json /root/.clawdbot/moltbot.json'
docker kill --signal=USR1 moltbot
```

### Просмотр текущей модели

```bash
docker logs moltbot 2>&1 | grep "agent model" | tail -1
```

### Добавление auth профиля

```bash
# Записать напрямую
docker exec moltbot sh -c 'cat > /root/.clawdbot/agents/main/agent/auth-profiles.json << EOF
{
  "profiles": [
    {
      "id": "anthropic",
      "provider": "anthropic",
      "apiKey": "YOUR_KEY",
      "default": true
    }
  ]
}
EOF'

# Применить
docker kill --signal=USR1 moltbot
```

### Очистка сессий

```bash
# Удалить данные сессий (полный сброс)
docker exec moltbot rm -rf /root/.clawdbot/sessions/*
docker restart moltbot
```

---

## Полезные ссылки

- [Moltbot Documentation](https://moltbot.dev/docs)
- [Anthropic Prompt Caching](https://docs.anthropic.com/claude/docs/prompt-caching)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)

---

## Changelog

| Дата | Версия | Изменения |
|------|--------|-----------|
| 2026-01-29 | 1.0 | Начальная документация |
