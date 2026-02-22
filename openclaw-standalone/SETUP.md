# OpenClaw Standalone — Документация

## Что это

Мультитенантная система управления Facebook рекламой + WhatsApp чатбот. Каждый клиент получает:
- Изолированный Docker контейнер с AI-агентом (Claude Opus / Haiku для WhatsApp)
- Свою базу данных PostgreSQL
- Свой gateway UI для взаимодействия с агентом
- Встроенный WhatsApp канал (Baileys) с автоматическим трекингом лидов
- CAPI (Conversions API) для отправки событий в Meta
- Набор skills для управления рекламой

## Текущее состояние

- **OpenClaw версия:** 2026.2.17
- **Docker image:** `openclaw-runtime` (node:22-slim + socat)
- **Gateway UI:** работает через HTTPS
- **HTTPS:** wildcard SSL `*.openclaw.performanteaiagency.com`
- **Nginx:** динамический роутинг subdomain → контейнер
- **Тестовый клиент:** `test.openclaw.performanteaiagency.com` (работает)

## Структура проекта

```
openclaw-standalone/
├── docker-compose.yml              # PostgreSQL + Webhook + Upload + сборка image
├── .env.example                    # Переменные окружения
│
├── openclaw-runtime/
│   ├── Dockerfile                  # Image для клиентских контейнеров
│   └── entrypoint.sh              # Запуск gateway + socat forwarder
│
├── scripts/
│   ├── create-client.sh           # Провизионирование нового клиента
│   ├── wa-message-hook.js         # Hook: парсинг Baileys JSON → wa_dialogs + leads
│   └── send-capi.sh              # Отправка CAPI событий (L1/L2/L3) в Meta
│
├── templates/
│   ├── openclaw.json.template     # Конфиг gateway (port + modelByChannel + hooks)
│   ├── CLAUDE.md.template         # Project instructions (DB, skills, API)
│   └── TOOLS.md.template          # Environment config для агента (DB, skills, WA, CAPI)
│
├── db/
│   ├── init.sql                   # Инициализация PostgreSQL (pgcrypto)
│   └── schema.sql                 # Схема БД (14 таблиц, идемпотентная)
│
└── skills/                         # 10 skills: Facebook Ads + WhatsApp
    ├── fb-onboarding/SKILL.md      # Первичная настройка клиента (8 шагов)
    ├── fb-dashboard/SKILL.md       # Дашборд, метрики
    ├── fb-optimize/SKILL.md        # Health Score, оптимизация бюджетов
    ├── fb-campaign/SKILL.md        # Создание кампаний
    ├── fb-scoring/SKILL.md         # Крон скоринга
    ├── fb-leads/SKILL.md           # Управление лидами
    ├── fb-creative-test/SKILL.md   # A/B тесты креативов
    ├── fb-report/SKILL.md          # Утренние/недельные отчёты
    ├── wa-onboarding/SKILL.md      # Подключение WhatsApp через Baileys QR
    └── wa-capi-setup/SKILL.md      # Настройка CAPI (pixel, events, threshold)
```

## Архитектура

### Docker сервисы (docker-compose.yml)

| Сервис | Контейнер | Порт (хост → контейнер) | Назначение |
|--------|-----------|-------------------------|------------|
| postgres | openclaw-postgres | 5435 → 5432 | Общая PostgreSQL для всех клиентов |
| webhook | openclaw-webhook | 9000 → 3000 | Приём Facebook Lead Gen вебхуков |
| upload | openclaw-upload | 9001 → 3001 | Загрузка креативов (до 500 МБ) |
| openclaw-runtime | — | — | Только сборка image (profile: build-only) |

Все сервисы на сети `openclaw-net`.

### Клиентские контейнеры (создаются через create-client.sh)

Каждый клиент — отдельный контейнер на базе `openclaw-runtime`:

```
docker run -d \
  --name openclaw-<slug> \
  --network openclaw-net \
  -p <GW_PORT>:18790 \
  -e "OPENCLAW_GATEWAY_TOKEN=<token>" \
  -v /home/openclaw/clients/<slug>/.openclaw:/home/openclaw/.openclaw \
  openclaw-runtime
```

### Проброс портов (решение проблемы с bind)

OpenClaw gateway жёстко привязан к `127.0.0.1:18789` — нет конфига для изменения bind address. Решение через socat:

```
Браузер → nginx (HTTPS) → host:GW_PORT → container:18790 (socat 0.0.0.0) → 127.0.0.1:18789 (gateway)
```

- `entrypoint.sh` создаёт необходимые директории (devices, cron, canvas, workspace)
- Запускает `openclaw gateway` в фоне (с token auth если задан `OPENCLAW_GATEWAY_TOKEN`)
- Ждёт готовности gateway (до 30 секунд)
- Запускает `socat TCP-LISTEN:18790,bind=0.0.0.0 → TCP:127.0.0.1:18789`

### HTTPS и Nginx

**DNS:** Wildcard A-запись `*.openclaw.performanteaiagency.com → IP сервера`

**SSL:** Wildcard сертификат:
```
/etc/letsencrypt/live/openclaw.performanteaiagency.com/fullchain.pem
/etc/letsencrypt/live/openclaw.performanteaiagency.com/privkey.pem
```

**Nginx:** В `nginx-production.conf` — map-блок для маршрутизации:
```nginx
map $openclaw_slug $openclaw_port {
    test    18789;
    # aliya   18790;
    # marat   18791;
}
```

При добавлении нового клиента нужно:
1. Добавить строку в map-блок nginx
2. `docker exec nginx nginx -s reload`

### Файловая структура клиента на сервере

```
/home/openclaw/clients/<slug>/
└── .openclaw/
    ├── openclaw.json            # {"gateway":{"port":18789,"mode":"local","trustedProxies":["127.0.0.1","::1"]}}
    ├── devices/                 # Паринг устройств (paired.json, pending.json)
    ├── canvas/                  # Canvas для агента
    ├── cron/                    # Cron jobs
    └── workspace/
        ├── CLAUDE.md            # Project instructions (DB, skills, API)
        ├── TOOLS.md             # Environment config (DB connection, skills, onboarding)
        ├── AGENTS.md            # OpenClaw agent framework (auto-generated)
        ├── SOUL.md              # Личность агента (auto-generated)
        ├── USER.md              # Информация о юзере (auto-generated)
        ├── MEMORY.md            # Долгосрочная память агента (auto-generated)
        ├── memory/              # Ежедневные заметки агента
        └── skills/              # Копия skills/ (НЕ симлинка!)
            ├── fb-onboarding/
            ├── fb-dashboard/
            └── ...
```

### Система файлов агента (OpenClaw Framework)

OpenClaw создаёт и читает свои файлы при каждой сессии:

| Файл | Назначение | Генерация |
|------|-----------|-----------|
| `AGENTS.md` | Инструкции: что читать при старте сессии | OpenClaw (auto) |
| `SOUL.md` | Личность, поведение, стиль общения | OpenClaw (auto) |
| `USER.md` | Имя, язык, таймзона юзера | OpenClaw (auto) |
| `MEMORY.md` | Долгосрочная память агента | Агент обновляет |
| `TOOLS.md` | **Environment config: БД, API, скиллы** | **Мы генерируем** |
| `CLAUDE.md` | Project instructions (дублирует TOOLS.md) | Мы генерируем |

**ВАЖНО:** Агент читает `TOOLS.md` для environment-специфичных настроек (подключение к БД, скиллы, API). Именно туда нужно класть всю конфигурацию. `CLAUDE.md` загружается как project instructions, но `TOOLS.md` — основной файл конфигурации среды.

## База данных

### Схема (14 таблиц на каждого клиента)

| # | Таблица | Назначение |
|---|---------|------------|
| 1 | config | Настройки (1 строка): FB токены, Telegram, timezone, target CPL |
| 2 | directions | Направления кампаний (whatsapp, lead_forms, instagram_traffic...) |
| 3 | direction_adsets | Адсеты в направлениях |
| 4 | creatives | Загруженные креативы (video, image, carousel) + кеш метрик |
| 5 | metrics_history | Ежедневные метрики (impressions, leads, spend, CTR, CPL, CPM) |
| 6 | ad_creative_mapping | Связь ad_id → creative_id + direction_id (для source_id resolution) |
| 7 | creative_tests | A/B тесты ($20 бюджет, 1000 показов, LLM-анализ) |
| 8 | scoring_history | Health Score по адсетам (формула 45 + тренды + диагностика) |
| 9 | leads | Входящие лиды (Lead Gen + WhatsApp) + ctwa_clid, ad_id, conversion_source |
| 10 | currency_rates | Курс валют (USD/KZT = 530) |
| 11 | scoring_executions | Лог запусков скоринга |
| 12 | wa_dialogs | Трекинг WhatsApp диалогов: счётчики, ad attribution, CAPI флаги |
| 13 | capi_settings | Настройки CAPI: pixel_id, access_token, event names, threshold |
| 14 | capi_events_log | Аудит отправленных CAPI событий (L1/L2/L3) |

Все CREATE TABLE с `IF NOT EXISTS`, INSERT с `ON CONFLICT DO NOTHING` — безопасно перезапускать.

## Провизионирование клиента

```bash
# От root, из /home/openclaw/agents-monorepo/openclaw-standalone
./scripts/create-client.sh <slug> [port]

# Пример:
./scripts/create-client.sh aliya 18790
./scripts/create-client.sh marat 18791
```

Скрипт автоматически:
1. Создаёт БД `openclaw_<slug>` (если не существует)
2. Применяет schema.sql (14 таблиц)
3. Создаёт workspace + **копирует** skills (не симлинка!)
4. Генерирует CLAUDE.md, TOOLS.md (подставляет slug) и openclaw.json
5. Генерирует gateway auth token
6. Устанавливает permissions (chown 1001:1001)
7. Запускает Docker контейнер с маппингом портов

### После создания клиента

1. **Добавить в nginx map-блок** (`nginx-production.conf`):
   ```nginx
   map $openclaw_slug $openclaw_port {
       test    18789;
       aliya   18790;  # ← добавить
   }
   ```
   И перезагрузить: `docker exec nginx nginx -s reload`

2. **Одобрить устройство** при первом подключении из браузера:
   ```bash
   docker exec openclaw-<slug> openclaw devices list
   docker exec openclaw-<slug> openclaw devices approve <request-id>
   ```

3. **Настроить API ключ** через TUI:
   ```bash
   docker exec -it openclaw-<slug> openclaw configure
   ```

4. **Открыть UI**: `https://<slug>.openclaw.performanteaiagency.com/#token=<gateway_token>`

5. **Онбординг запустится автоматически** — агент проверит config и запустит `fb-onboarding/SKILL.md` если FB токен не настроен.

### Обновление skills для существующего клиента

```bash
# Удалить старые (могут быть симлинкой)
rm -rf /home/openclaw/clients/<slug>/.openclaw/workspace/skills
# Скопировать новые
cp -r ~/agents-monorepo/openclaw-standalone/skills /home/openclaw/clients/<slug>/.openclaw/workspace/skills
chown -R 1001:1001 /home/openclaw/clients/<slug>/.openclaw/workspace/skills
```

### Обновление TOOLS.md / CLAUDE.md для существующего клиента

```bash
cd ~/agents-monorepo/openclaw-standalone
sed "s/{{SLUG}}/<slug>/g" templates/TOOLS.md.template > /home/openclaw/clients/<slug>/.openclaw/workspace/TOOLS.md
sed "s/{{SLUG}}/<slug>/g" templates/CLAUDE.md.template > /home/openclaw/clients/<slug>/.openclaw/workspace/CLAUDE.md
chown 1001:1001 /home/openclaw/clients/<slug>/.openclaw/workspace/TOOLS.md
chown 1001:1001 /home/openclaw/clients/<slug>/.openclaw/workspace/CLAUDE.md
```

Перезапуск контейнера **не нужен** — агент читает файлы при каждом новом сообщении.

## Сборка и запуск

### Первый запуск

```bash
cd /home/openclaw/agents-monorepo/openclaw-standalone

# Запуск PostgreSQL + Webhook + Upload
docker compose up -d

# Сборка image для клиентских контейнеров
docker compose build openclaw-runtime

# Создание первого клиента
./scripts/create-client.sh test 18789
```

### Пересборка image (после обновлений)

```bash
cd openclaw-standalone/openclaw-runtime
docker build -t openclaw-runtime .

# Пересоздать контейнеры клиентов
docker rm -f openclaw-test
docker run -d \
  --name openclaw-test \
  --network openclaw-net \
  --restart unless-stopped \
  -p 18789:18790 \
  -e "OPENCLAW_GATEWAY_TOKEN=<token>" \
  -v /home/openclaw/clients/test/.openclaw:/home/openclaw/.openclaw \
  openclaw-runtime
```

## Решённые проблемы

### Alpine vs Debian
`node:22-alpine` не подходит — node-llama-cpp (зависимость OpenClaw) требует glibc. Используем `node:22-slim` (Debian).

### node-llama-cpp
Зависимость для локальных LLM — не нужна при использовании Anthropic API. Пропускаем:
- `ENV NODE_LLAMA_CPP_SKIP_DOWNLOAD=true`
- `npm install -g --ignore-scripts`

### Gateway bind 127.0.0.1
OpenClaw gateway не поддерживает `gateway.bind` в конфиге (ошибка "Invalid input"). Решено через socat в entrypoint.sh.

### --network host
С `--network host` gateway слушал на localhost хоста, но был недоступен извне. Переключились на `--network openclaw-net` + маппинг портов через socat.

### UID mismatch (EACCES)
Контейнер работает под пользователем `openclaw` **(UID 1001, не 1000)**. Базовый образ `node:22-slim` уже занимает UID 1000 для юзера `node`. Решение:
- Dockerfile: `useradd -m -d /home/openclaw -u 1001 openclaw`
- create-client.sh: `chown -R 1001:1001`
- entrypoint.sh создаёт поддиректории (devices, cron, canvas, workspace)

### Secure Context (HTTPS)
OpenClaw UI требует HTTPS для WebSocket. Решено wildcard SSL сертификатом через certbot DNS challenge.

### trustedProxies
Gateway не доверял соединениям через socat proxy → требовал device pairing даже с правильным token. Решено добавлением `"trustedProxies": ["127.0.0.1", "::1"]` в openclaw.json.

### Device pairing
Даже с token auth, gateway требует явное одобрение каждого нового устройства (браузера). При первом подключении нужно: `openclaw devices approve <request-id>`.

### Skills: симлинка vs копия
Симлинки не работают внутри контейнера — только `.openclaw/` монтируется как volume, и симлинка указывает на несуществующий путь. Решение: `cp -r` вместо `ln -sf` в create-client.sh.

### TOOLS.md — основной конфиг для агента
OpenClaw имеет свою систему файлов (AGENTS.md, SOUL.md, USER.md). Агент читает `TOOLS.md` для environment-специфичных настроек. Первоначально конфиг был только в `CLAUDE.md`, но агент не видел его. Решение: дублировать конфигурацию в `TOOLS.md.template`.

## Следующие шаги

### WhatsApp + CAPI архитектура

```
Baileys (WhatsApp WebSocket)
     │ message:received
     ▼
Hook: wa-message-hook.js
  ├── Парсит Baileys JSON
  ├── Извлекает source_id (ad_id), ctwa_clid
  ├── UPSERT wa_dialogs
  ├── Resolve: ad_creative_mapping → creative_id + direction_id
  └── INSERT leads (если с рекламы)
     │
     ▼
Claude агент (Haiku 4.5 для WhatsApp)
  ├── Отвечает клиенту по промпту
  ├── Обновляет qualification / summary
  └── Вызывает send-capi.sh при достижении порога
     │
     ▼
send-capi.sh → Meta Graph API POST /{pixel_id}/events
  ├── L1 (LeadSubmitted): capi_msg_count >= threshold
  ├── L2 (CompleteRegistration): qualification = 'interested'
  └── L3 (Purchase): qualification = 'scheduled'
```

**Модель на WhatsApp:** Haiku 4.5 через `modelByChannel` в openclaw.json — дешевле в ~60x и быстрее чем Opus.

**Ad Attribution:** WhatsApp сообщение с рекламы содержит `source_id` (= ad_id Facebook). Hook резолвит его через `ad_creative_mapping` для привязки к конкретному креативу и направлению.

### 1. Telegram интеграция

Добавить поддержку Telegram bot token в:
- openclaw.json.template
- create-client.sh (аргумент или интерактивный ввод)

## Полезные команды

```bash
# Логи клиента
docker logs -f openclaw-<slug>

# TUI (терминальный интерфейс) внутри контейнера
docker exec -it openclaw-<slug> openclaw tui

# Настройка API ключей
docker exec -it openclaw-<slug> openclaw configure

# Список устройств (паринг)
docker exec openclaw-<slug> openclaw devices list

# Одобрение устройства
docker exec openclaw-<slug> openclaw devices approve <request-id>

# Проверка gateway изнутри контейнера
docker exec openclaw-<slug> curl -s http://127.0.0.1:18789

# Список всех клиентских контейнеров
docker ps --filter "name=openclaw-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# SQL запрос к БД клиента
docker exec -i openclaw-postgres psql -U postgres -d openclaw_<slug> -c "SELECT * FROM config"

# Рестарт контейнера клиента
docker restart openclaw-<slug>

# Обновить skills у клиента
rm -rf /home/openclaw/clients/<slug>/.openclaw/workspace/skills
cp -r ~/agents-monorepo/openclaw-standalone/skills /home/openclaw/clients/<slug>/.openclaw/workspace/skills
chown -R 1001:1001 /home/openclaw/clients/<slug>/.openclaw/workspace/skills
```
