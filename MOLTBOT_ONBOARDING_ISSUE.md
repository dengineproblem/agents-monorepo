# Moltbot Onboarding Issue - Debugging Log

**Дата:** 2024-02-04
**Статус:** НЕ РЕШЕНО - Бот получает сообщения но не отвечает

---

## Краткое описание проблемы

Moltbot Gateway запущен и получает сообщения от Telegram, но **не обрабатывает их**. Агент router не запускается или не подключается к gateway.

### Желаемое поведение
1. Пользователь отправляет `/start` в Telegram бот @prfmntai_bot
2. Moltbot Gateway получает сообщение
3. Router агент обрабатывает сообщение через GPT 5.2
4. Пользователь получает ответ с началом онбординга (15 вопросов)

### Текущее поведение
1. ✅ Gateway запущен и работает (порт 18789)
2. ✅ Telegram provider активен
3. ✅ Gateway получает сообщения от Telegram
4. ❌ Агент НЕ обрабатывает сообщения
5. ❌ Пользователь НЕ получает ответ

---

## Архитектура Moltbot (что мы поняли)

### Gateway Modes

**1. Local Mode** (`gateway.mode: "local"`)
- Gateway запускается и **ждёт подключения агентов** через WebSocket
- Агенты запускаются как отдельные процессы: `moltbot agent start <agent-id>`
- Агенты подключаются к gateway через ws://gateway:18789
- В логах видно: `clients=N` где N > 0 когда агенты подключены

**2. Embedded Mode** (предположительно)
- Gateway автоматически запускает агентов **внутри своего процесса**
- Не требует отдельного запуска агентов
- В логах: `clients=0` это нормально (агенты не подключаются через WebSocket, а работают внутри процесса)
- В логах должны быть: `[agent/embedded]` при обработке сообщений

**3. Unconfigured Mode** (`--allow-unconfigured`)
- Разрешает запуск gateway БЕЗ настроенных агентов
- Gateway работает, но **не обрабатывает сообщения** (некому)
- Используется для отладки или когда агенты подключаются позже

---

## Конфигурация Single-Workspace

**Цель:** 1 router агент с доступом ко всем инструментам (facebook-ads, creatives, crm, tiktok, onboarding)

### Текущая конфигурация

**services/moltbot/moltbot-config-template.json:**
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/gpt-5.2"
      }
    },
    "list": [
      {
        "id": "router",
        "default": true,
        "name": "Multi-Domain Specialist Agent",
        "workspace": "/root/clawd/moltbot-workspace-router",
        "agentDir": "~/.moltbot/agents/router",
        "model": {
          "primary": "openai/gpt-5.2"
        }
      }
    ]
  },
  "bindings": [
    {
      "agentId": "router",
      "match": {
        "channel": "telegram"
      }
    }
  ],
  "channels": {
    "telegram": {
      "enabled": true,
      "dmPolicy": "open",
      "botToken": "${MOLTBOT_TELEGRAM_BOT_TOKEN}",
      "allowFrom": ["*"],
      "groupPolicy": "allowlist",
      "streamMode": "partial"
    }
  }
}
```

**services/moltbot/docker-entrypoint.sh:**
```bash
#!/bin/sh
set -e

# Setup moltbot directory
mkdir -p /root/.moltbot

# Copy config template
cp /root/clawd/moltbot-config-template.json /root/.moltbot/moltbot.json

# Replace environment variables
sed -i "s/\${MOLTBOT_TELEGRAM_BOT_TOKEN}/$MOLTBOT_TELEGRAM_BOT_TOKEN/g" /root/.moltbot/moltbot.json

# Setup auth profile for router agent
mkdir -p "/root/.moltbot/agents/router/agent"
echo '{"profiles":[{"id":"google","provider":"google","apiKey":"'"$GEMINI_API_KEY"'","default":true},{"id":"openai","provider":"openai","apiKey":"'"$OPENAI_API_KEY"'","model":"gpt-5.2"},{"id":"anthropic","provider":"anthropic","apiKey":"'"$ANTHROPIC_API_KEY"'"}],"whisper":{"provider":"openai","model":"gpt-4o"}}' > "/root/.moltbot/agents/router/agent/auth-profiles.json"

# Start Moltbot Gateway
exec moltbot gateway --bind lan --token "moltbot-dev-token-2026" --allow-unconfigured --verbose
```

**docker-compose.yml (moltbot service):**
```yaml
moltbot:
  build: ./services/moltbot
  container_name: moltbot
  env_file:
    - ./.env.brain
  ports:
    - "18789:18789"
  environment:
    - AGENT_SERVICE_URL=http://agent-service:8082
    - MOLTBOT_TOKEN=moltbot-dev-token-2026
    - OPENCLAW_TOOLS_SANDBOX_ALLOW=sessions_*,system/*
    - MOLTBOT_AGENT_TOOLS_AUTO_REGISTER=true
    - OPENCLAW_GATEWAY_OPENAI_TOOL_SCHEMA=true
  volumes:
    - ./moltbot-workspace-router:/root/clawd/moltbot-workspace-router
    - ./moltbot-workspace-facebook:/root/clawd/moltbot-workspace-facebook
    - ./moltbot-workspace-creatives:/root/clawd/moltbot-workspace-creatives
    - ./moltbot-workspace-crm:/root/clawd/moltbot-workspace-crm
```

---

## Хронология попыток решения

### Попытка 1: Использовать `gateway.mode: "embedded"`
**Конфиг:**
```json
{
  "gateway": {
    "mode": "embedded"
  },
  "agents": { ... }
}
```

**Результат:** ❌ Ошибка валидации
```
Invalid config at /root/.moltbot/moltbot.json: gateway.mode: Invalid input
```

**Вывод:** "embedded" не является валидным значением для gateway.mode

---

### Попытка 2: Убрать gateway section полностью
**Конфиг:**
```json
{
  "agents": { ... }
}
```

**Команда:**
```bash
exec moltbot gateway --bind lan --token "moltbot-dev-token-2026" --verbose
```

**Результат:** ❌ Gateway требует mode
```
Gateway start blocked: set gateway.mode=local (current: unset) or pass --allow-unconfigured
```

**Вывод:** Gateway требует явного указания mode или флага --allow-unconfigured

---

### Попытка 3: `gateway.mode: "local"` (стандартный режим)
**Конфиг:**
```json
{
  "gateway": {
    "mode": "local"
  },
  "agents": { ... }
}
```

**Команда:**
```bash
exec moltbot gateway --bind lan --token "moltbot-dev-token-2026" --verbose
```

**Результат:** ✅ Gateway запустился, ❌ агенты не обрабатывают сообщения

**Логи:**
```
[gateway] listening on ws://0.0.0.0:18789 (PID 18)
[telegram] [default] starting provider (@prfmntai_bot)
[ws] → event health seq=1 clients=0 presenceVersion=1 healthVersion=2
[telegram] update: {"update_id":329885180,"message":{...,"text":"/start"...}}
[telegram] update: {"update_id":329885181,"message":{...,"text":"?"...}}
```

**Анализ:**
- Gateway получает сообщения (`[telegram] update`)
- `clients=0` - нет подключенных агентов
- Нет логов `[agent/embedded]` или подобных - агент не обрабатывает

**Вывод:** В local mode агенты должны подключаться отдельно, но мы их не запускали

---

### Попытка 4: Попытка запустить агента через `moltbot agent start router`
**Команда:**
```bash
docker exec moltbot moltbot agent start router
```

**Результат:** ❌ Ошибка - неправильный синтаксис команды
```
required option '-m, --message <text>' not specified
```

**Вывод:** `moltbot agent` используется для отправки сообщений агенту, а не для запуска агента как сервиса

---

### Попытка 5: Убрать gateway.mode + флаг `--allow-unconfigured` (ТЕКУЩЕЕ СОСТОЯНИЕ)
**Конфиг:**
```json
{
  "agents": { ... }
  // БЕЗ gateway section
}
```

**Команда:**
```bash
exec moltbot gateway --bind lan --token "moltbot-dev-token-2026" --allow-unconfigured --verbose
```

**Результат:** ✅ Gateway запустился, ❌ агенты не обрабатывают сообщения

**Логи (из /tmp/moltbot/moltbot-2026-02-04.log):**
```json
{"1":"→ event tick seq=2 clients=0 dropIfSlow=true","time":"2026-02-04T03:56:19.947Z"}
{"1":"telegram update: {\"update_id\":329885184,\"message\":{...\"text\":\"/start\"...}}","time":"2026-02-04T03:56:54.664Z"}
{"1":"→ event tick seq=5 clients=0 dropIfSlow=true","time":"2026-02-04T03:57:19.959Z"}
```

**Анализ:**
- Gateway работает
- Получает сообщения от Telegram
- `clients=0` - нет подключенных агентов
- **НЕТ ОБРАБОТКИ** - только tick события, никаких логов агента

**Вывод:** `--allow-unconfigured` позволяет gateway работать БЕЗ агентов, но **не запускает их автоматически**

---

## Проверенные факты

### ✅ Что работает:
1. Gateway запускается успешно
2. Telegram provider подключается к боту @prfmntai_bot
3. Gateway получает webhook updates от Telegram
4. Workspace существует в контейнере: `/root/clawd/moltbot-workspace-router/` с AGENTS.md, SOUL.md и т.д.
5. auth-profiles.json создаётся с правильными API ключами
6. Bindings настроены: все telegram сообщения должны идти агенту "router"
7. Docker volumes смонтированы правильно
8. Порт 18789 доступен

### ❌ Что НЕ работает:
1. Агент router не обрабатывает сообщения
2. `clients=0` постоянно - агент не подключается к gateway
3. Нет логов `[agent/embedded]` или подобных
4. Пользователь не получает ответов от бота

---

## Диагностические команды

### Проверка состояния на prod сервере:

```bash
# 1. Статус контейнера
docker ps | grep moltbot

# 2. Процессы внутри контейнера
docker exec moltbot ps aux

# 3. Логи gateway
docker exec moltbot tail -50 /tmp/moltbot/moltbot-2026-02-04.log

# 4. Конфиг moltbot
docker exec moltbot cat /root/.moltbot/moltbot.json

# 5. Auth profiles
docker exec moltbot cat /root/.moltbot/agents/router/agent/auth-profiles.json

# 6. Workspace файлы
docker exec moltbot ls -la /root/clawd/moltbot-workspace-router/

# 7. Логи в реальном времени
docker exec moltbot tail -f /tmp/moltbot/moltbot-2026-02-04.log
# (затем отправить сообщение боту)
```

---

## Гипотезы о причине проблемы

### Гипотеза 1: Агент должен запускаться отдельным процессом
**Описание:** В local mode агенты должны запускаться отдельной командой и подключаться к gateway через WebSocket

**Что проверить:**
- Найти правильный синтаксис запуска агента (не `moltbot agent start`, а что-то другое)
- Возможно нужна команда типа `moltbot agent serve --id router`
- Или агент запускается через `moltbot run` или подобное

**Действие:**
```bash
# Проверить help для всех команд moltbot
docker exec moltbot moltbot --help
docker exec moltbot moltbot agent --help
docker exec moltbot moltbot run --help  # если существует
```

---

### Гипотеза 2: Нужна другая конфигурация для embedded режима
**Описание:** Возможно есть способ запустить gateway так, чтобы он автоматически запускал агентов внутри процесса

**Что проверить:**
- Документация Moltbot про embedded agents
- Примеры конфигов для single-agent setup
- Возможно нужен параметр в agents.list типа `"embedded": true`
- Или специальный флаг при запуске gateway

**Действие:**
- Изучить документацию moltbot (если есть)
- Проверить примеры в репозитории moltbot
- Поискать в workspace файлах подсказки о правильной конфигурации

---

### Гипотеза 3: Workspace неправильно инициализирован
**Описание:** Возможно агент не может запуститься из-за проблем с workspace или agentDir

**Что проверить:**
- Права доступа к workspace файлам
- Структура workspace (все ли файлы на месте)
- Инициализация agentDir (возможно нужны дополнительные файлы)

**Действие:**
```bash
# Проверить права
docker exec moltbot ls -la /root/clawd/moltbot-workspace-router/
docker exec moltbot ls -la /root/.moltbot/agents/router/

# Проверить что внутри agentDir
docker exec moltbot find /root/.moltbot/agents/router/ -type f
```

---

### Гипотеза 4: Проблема с bindings или routing
**Описание:** Возможно bindings настроены неправильно и сообщения не маршрутизируются к агенту

**Что проверить:**
- Синтаксис bindings
- Логи gateway - есть ли ошибки маршрутизации
- Возможно нужен другой формат match для telegram

**Действие:**
- Поискать в логах строки про bindings, routing, dispatch
- Проверить примеры bindings конфигурации

---

### Гипотеза 5: Нужен supervisord или другой process manager
**Описание:** Возможно для запуска и gateway и агента в одном контейнере нужен supervisord

**Что делать:**
- Добавить supervisord в Dockerfile
- Создать конфиги для gateway и agent
- Запустить оба процесса через supervisor

**Пример supervisord.conf:**
```ini
[program:moltbot-gateway]
command=moltbot gateway --bind lan --token "moltbot-dev-token-2026" --verbose
autostart=true
autorestart=true

[program:moltbot-agent-router]
command=moltbot agent serve --id router  # если такая команда существует
autostart=true
autorestart=true
```

---

## Связанные файлы

### Основные конфиги:
- `services/moltbot/Dockerfile` - сборка образа
- `services/moltbot/docker-entrypoint.sh` - скрипт запуска
- `services/moltbot/moltbot-config-template.json` - конфиг moltbot
- `docker-compose.yml` (секция moltbot) - docker compose настройки

### Workspace:
- `moltbot-workspace-router/AGENTS.md` - инструкции для агента (82KB)
- `moltbot-workspace-router/SOUL.md` - личность агента
- `moltbot-workspace-router/TOOLS.md` - доступные инструменты
- `moltbot-workspace-router/moltbot.json` - конфиг workspace

### Изменённые файлы для onboarding fix:
- `moltbot-workspace-router/AGENTS.md` - улучшенные инструкции для передачи username/password
- `services/agent-service/src/routes/telegramWebhook.ts` - добавлен флаг ENABLE_LEGACY_ONBOARDING

---

## План дальнейших действий

### Шаг 1: Изучить документацию moltbot
```bash
# Посмотреть все доступные команды
docker exec moltbot moltbot --help

# Проверить help для команд agent
docker exec moltbot moltbot agent --help

# Проверить версию moltbot
docker exec moltbot moltbot --version
```

### Шаг 2: Попробовать запустить агента вручную
Найти правильный синтаксис запуска агента и попробовать запустить его вручную, затем проверить подключается ли он к gateway (clients должно стать > 0)

### Шаг 3: Если найдена команда запуска агента - обновить docker-entrypoint.sh
Использовать supervisord или & для запуска и gateway и agent:
```bash
# Вариант с &
moltbot gateway --bind lan --token "..." --verbose &
sleep 5  # дать gateway времени запуститься
moltbot agent serve --id router  # если такая команда существует
wait
```

### Шаг 4: Альтернативный подход - изучить примеры
- Поискать в Issues/Discussions репозитория moltbot примеры single-agent setup
- Проверить есть ли документация по telegram bot интеграции
- Найти working examples конфигурации

---

## Контакты и ресурсы

**Telegram бот:** @prfmntai_bot (8584683514:AAFxTNn33isfmJMKR82-KYxf_p1LED0hWTM)
**Gateway URL:** ws://0.0.0.0:18789
**Prod сервер:** ubuntu-s-2vcpu-4gb-120gb-intel-nyc1-01

**Связанная документация:**
- План исправлений: `/Users/anatolijstepanov/.claude/plans/velvety-wishing-cosmos.md`
- Архитектура: `INFRASTRUCTURE.md`

---

## Заметки

1. Legacy onboarding успешно отключён через ENABLE_LEGACY_ONBOARDING=false
2. GPT 5.2 модель правильно настроена в конфиге
3. Проблема не в webhook или telegram integration - gateway успешно получает сообщения
4. Проблема именно в том что агент не запускается или не обрабатывает сообщения
5. `clients=0` постоянно - это ключевой индикатор что агенты не подключены к gateway

---

### Попытка 6: Убрать `--allow-unconfigured` для embedded режима (ТЕКУЩЕЕ ИСПРАВЛЕНИЕ)
**Конфиг:**
```json
{
  "agents": {
    "list": [{ "id": "router", ... }]
  }
  // БЕЗ gateway section
}
```

**Команда:**
```bash
exec moltbot gateway --bind lan --token "moltbot-dev-token-2026" --verbose
# ↑ БЕЗ флага --allow-unconfigured!
```

**Гипотеза:**
- Флаг `--allow-unconfigured` **отключает** автоматический запуск агентов
- БЕЗ этого флага Gateway должен автоматически запустить router агента в embedded режиме
- `clients=0` будет нормально (embedded не использует WebSocket)
- В логах должны появиться `[agent/router]` при обработке сообщений

**Ожидаемый результат:**
```bash
[gateway] listening on ws://0.0.0.0:18789
[agent/router] bootstrapping agent...  ← НОВОЕ!
[agent/router] loaded workspace /root/clawd/moltbot-workspace-router
[telegram] update: {..."/start"...}
[agent/router] embedded run start  ← НОВОЕ!
```

**Статус:** ❌ НЕ СРАБОТАЛО

**Файлы изменены:**
- `services/moltbot/docker-entrypoint.sh` - убран флаг `--allow-unconfigured`

**Результат:**
```
Gateway start blocked: set gateway.mode=local (current: unset) or pass --allow-unconfigured.
```

**Анализ:**
- Gateway ТРЕБУЕТ явного указания режима
- БЕЗ `gateway.mode` в конфиге Gateway отказывается запускаться
- Это та же ошибка что и в Попытке №2

**Вывод:**
- Embedded режим НЕ активируется автоматически при наличии `agents.list[]`
- Gateway требует ОБЯЗАТЕЛЬНО либо `gateway.mode=local`, либо флаг `--allow-unconfigured`
- Нужен другой подход

---

### Попытка 7: `gateway.mode: "local"` + запуск агента в фоне (В ПРОЦЕССЕ)

**Гипотеза:**
- Добавить `gateway.mode: "local"` в конфиг
- Запустить gateway в фоне (&)
- Запустить router агента отдельным процессом
- Использовать supervisord или простой & + wait

**План:**
1. Добавить в `moltbot-config-template.json`:
```json
{
  "gateway": {
    "mode": "local"
  },
  "agents": { "list": [...] }
}
```

2. Изменить `docker-entrypoint.sh`:
```bash
# Запуск gateway в фоне
moltbot gateway --bind lan --token "..." --verbose &
GATEWAY_PID=$!

# Ждем запуска gateway
sleep 5

# Найти правильную команду запуска агента
# Варианты: moltbot agent serve/run/start?
```

3. Проверить `moltbot --help` для поиска команды запуска агента

**Статус:** ✅ Gateway запустился, ❌ НЕТ `telegram inbound`

**Файлы изменены:**
- `services/moltbot/moltbot-config-template.json` - добавлен `gateway.mode: "local"` и `gateway.auth.token`
- `services/moltbot/docker-entrypoint.sh` - убран `--allow-unconfigured`, обновлен токен на `moltbot-prod-token-2026`

**Результат (логи):**
```
[gateway] listening on ws://0.0.0.0:18789 (PID 18)
[telegram] [default] starting provider (@prfmntai_bot)
[ws] → event health seq=1 clients=0 presenceVersion=1 healthVersion=2
[telegram] update: {"update_id":329885190,..."text":"/start"...}
```

**Анализ:**
- ✅ Gateway запустился успешно
- ✅ Telegram provider активен
- ✅ Gateway получает сообщения
- ❌ **НЕТ строки `telegram inbound`** - Gateway НЕ передает сообщение в обработку!
- ❌ НЕТ логов `[agent/embedded]` - агент не вызывается

**Сравнение с локальной working версией:**
```
# ЛОКАЛЬНО (работает):
[telegram] update: {...}
telegram inbound: chatId=313145981 ...  ← ЕСТЬ!
[agent/embedded] embedded run start  ← ЕСТЬ!

# PRODUCTION (не работает):
[telegram] update: {...}
[ws] → event tick  ← НЕТ telegram inbound!
```

**Вывод:**
- Проблема НЕ в подключении агента через WebSocket (embedded режим и так не использует WebSocket)
- Проблема в том что Gateway НЕ передает telegram сообщения в routing/processing pipeline
- Bindings или channel configuration работают неправильно

---

### Попытка 8: Синхронизировать MOLTBOT_TOKEN env var

**Обнаружено:**
Environment переменная `MOLTBOT_TOKEN=moltbot-dev-token-2026` в docker-compose.yml НЕ синхронизирована с конфигом

**Гипотеза:**
Environment переменная может перезаписывать токен из конфига, вызывая несоответствие токенов

**Файлы изменены:**
- `docker-compose.yml` line 367: `MOLTBOT_TOKEN=moltbot-prod-token-2026` (было `moltbot-dev-token-2026`)

**Результат:** ❌ ТА ЖЕ ПРОБЛЕМА

**Логи после изменения:**
```
[gateway] listening on ws://0.0.0.0:18789
[telegram] [default] starting provider (@prfmntai_bot)
[telegram] update: {..."text":"/start"...}
```

**Анализ:**
- Все токены теперь синхронизированы (entrypoint, config, env var)
- Gateway запускается успешно
- НО все равно НЕТ `telegram inbound`

**Вывод:**
- Проблема НЕ в токене
- Нужен другой подход - изучить почему Gateway не создает `telegram inbound` events

---

## Критическое открытие

**Проблема локализована:** Gateway получает `[telegram] update`, но НЕ создает `telegram inbound` event для routing к агенту.

**Локально работающая конфигурация:**
- `gateway.mode: "local"`
- `gateway.auth.token: "moltbot-dev-token-2026"`
- `MOLTBOT_TOKEN=moltbot-dev-token-2026`
- Telegram bot: @moltbot_dev_prfmnt_bot

**Production НЕ работающая конфигурация:**
- `gateway.mode: "local"`
- `gateway.auth.token: "moltbot-prod-token-2026"`
- `MOLTBOT_TOKEN=moltbot-prod-token-2026`
- Telegram bot: @prfmntai_bot

**Ключевое различие в логах:**
- Локально: `telegram inbound` event создается → агент обрабатывает
- Production: `telegram inbound` НЕ создается → агент не вызывается

**Возможные причины:**
1. ❓ Bindings не применяются на production
2. ❓ Telegram channel configuration отличается
3. ❓ Какая-то другая настройка в конфиге локально отличается
4. ❓ Версии moltbot отличаются (local vs production)

**Следующие шаги для диагностики:**
1. Сравнить ПОЛНЫЕ конфиги local vs production (не только gateway секцию)
2. Проверить версии moltbot binary (`moltbot --version`)
3. Проверить логи на наличие ошибок bindings/routing
4. Изучить Moltbot code/docs - что влияет на создание `telegram inbound` event

---

**Последнее обновление:** 2026-02-04 04:38 UTC
**Статус:** Попытки №6-8 FAILED. Проблема: Gateway не создает `telegram inbound` events. Нужна глубокая диагностика конфигурации.
