# OpenClaw Standalone — Документация

## Что это

Мультитенантная система управления рекламой и лидами. Каждый клиент получает:
- Изолированный Docker контейнер с AI-агентом (Claude Opus)
- Свою базу данных PostgreSQL (38 таблиц)
- Свой gateway UI для взаимодействия с агентом
- Набор skills для управления рекламой, WhatsApp, CRM
- WhatsApp интеграцию через Evolution API + SaaS chatbot

## Текущее состояние

- **OpenClaw версия:** 2026.2.17
- **Docker image:** `openclaw-runtime` (node:22-slim + socat)
- **Gateway UI:** работает через HTTPS
- **HTTPS:** wildcard SSL `*.openclaw.performanteaiagency.com`
- **Nginx:** динамический роутинг subdomain → контейнер
- **WhatsApp:** Evolution API + chatbot-router → SaaS chatbot-service
- **Тестовый клиент:** `test.openclaw.performanteaiagency.com` (работает)

## Структура проекта

```
openclaw-standalone/
├── docker-compose.yml              # PostgreSQL + Webhook + Upload + Evolution + Router + Redis
├── .env.example                    # Переменные окружения
│
├── openclaw-runtime/
│   ├── Dockerfile                  # Image для клиентских контейнеров
│   └── entrypoint.sh              # Запуск gateway + socat forwarder
│
├── chatbot-router/                 # Маршрутизация Evolution → SaaS chatbot (JSON logging, graceful shutdown)
│   ├── index.js                   # Webhook обработка + Evolution proxy
│   ├── package.json
│   └── Dockerfile
│
├── scripts/
│   ├── create-client.sh           # Провизионирование нового клиента (+SaaS pairing)
│   └── sync-leads.sh             # Синхронизация WhatsApp лидов из SaaS
│
├── templates/
│   ├── openclaw.json.template     # Конфиг gateway (port + mode + trustedProxies)
│   ├── CLAUDE.md.template         # Project instructions (DB, skills, API)
│   └── TOOLS.md.template          # Environment config (DB, SaaS, skills, onboarding)
│
├── db/
│   ├── init.sql                   # Инициализация PostgreSQL (pgcrypto)
│   ├── init-evolution.sh          # Создание БД для Evolution API (shell-скрипт)
│   ├── schema.sql                 # Схема БД (38 таблиц, идемпотентная)
│   └── migrate-existing.sql       # Миграция существующих клиентов
│
├── webhook-service/               # Facebook Lead Gen webhook приёмник (JSON logging, graceful shutdown)
│   └── index.js
│
├── upload-service/                # Загрузка креативов
│
└── skills/                         # 13 skills
    ├── fb-onboarding/SKILL.md      # Первичная настройка FB
    ├── fb-dashboard/SKILL.md       # Дашборд, метрики
    ├── fb-optimize/SKILL.md        # Health Score, оптимизация бюджетов
    ├── fb-campaign/SKILL.md        # Создание кампаний
    ├── fb-scoring/SKILL.md         # Крон скоринга
    ├── fb-leads/SKILL.md           # Управление лидами
    ├── fb-creative-test/SKILL.md   # A/B тесты креативов
    ├── fb-report/SKILL.md          # Отчёты
    ├── wa-onboarding/SKILL.md      # Подключение WhatsApp
    ├── wa-bot-config/SKILL.md      # Настройка AI чатбота
    ├── wa-capi-setup/SKILL.md      # Настройка CAPI
    ├── wa-leads-sync/SKILL.md      # Синхронизация WhatsApp лидов
    └── crm-connect/SKILL.md        # Подключение AmoCRM / Bitrix24
```

## Архитектура

### Docker сервисы (docker-compose.yml)

| Сервис | Контейнер | Порт (хост → контейнер) | Назначение |
|--------|-----------|-------------------------|------------|
| postgres | openclaw-postgres | 5435 → 5432 | Общая PostgreSQL для всех клиентов + Evolution |
| webhook | openclaw-webhook | 9000 → 3000 | Приём Facebook Lead Gen вебхуков |
| upload | openclaw-upload | 9001 → 3001 | Загрузка креативов (до 500 МБ) |
| evolution-api | openclaw-evolution | 8080 → 8080 | WhatsApp через Evolution API |
| chatbot-router | openclaw-chatbot-router | 9002 → 3002 | Маршрутизация webhook'ов Evolution → SaaS |
| redis | openclaw-redis | — | Кеширование для Evolution API |
| openclaw-runtime | — | — | Только сборка image (profile: build-only) |

Все сервисы на сети `openclaw-net`.

### Архитектура WhatsApp / Chatbot

```
Evolution API (docker-compose)
    │
    ▼ webhook
Chatbot Router (docker-compose)
    │ resolves instanceName → user_account_id (SaaS DB)
    ▼ forwards
Chatbot Service (SaaS)
    │ processes messages, AI bot, CAPI
    ▼
Supabase (SaaS DB)
    │ whatsapp_instances, dialog_analysis, capi_events_log
    │
OpenClaw Agent (psql to Supabase)
    │ reads WhatsApp data via saas_db_url
    ▼
Local PostgreSQL (openclaw_{slug})
    │ leads, metrics, creatives, config
```

**SaaS Pairing:** Каждый OpenClaw клиент привязан к аккаунту в SaaS через:
- `config.saas_account_id` → `user_accounts.id` (Supabase)
- `config.saas_ad_account_id` → `ad_accounts.id` (Supabase)
- `config.saas_db_url` → строка подключения к Supabase

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
        ├── TOOLS.md             # Environment config (DB, SaaS, skills, onboarding)
        ├── AGENTS.md            # OpenClaw agent framework (auto-generated)
        ├── SOUL.md              # Личность агента (auto-generated)
        ├── USER.md              # Информация о юзере (auto-generated)
        ├── MEMORY.md            # Долгосрочная память агента (auto-generated)
        ├── memory/              # Ежедневные заметки агента
        └── skills/              # Копия skills/ (НЕ симлинка!)
            ├── fb-onboarding/
            ├── wa-onboarding/
            ├── crm-connect/
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
| `TOOLS.md` | **Environment config: БД, SaaS, API, скиллы** | **Мы генерируем** |
| `CLAUDE.md` | Project instructions (дублирует TOOLS.md) | Мы генерируем |

**ВАЖНО:** Агент читает `TOOLS.md` для environment-специфичных настроек (подключение к БД, скиллы, API). Именно туда нужно класть всю конфигурацию. `CLAUDE.md` загружается как project instructions, но `TOOLS.md` — основной файл конфигурации среды.

## База данных

### Схема (38 таблиц на каждого клиента)

#### Основные настройки
| # | Таблица | Назначение |
|---|---------|------------|
| 1 | config | Настройки (1 строка): FB, TikTok, AmoCRM, Bitrix24, WhatsApp, Telegram, AI keys, autopilot, SaaS pairing |
| 2 | currency_rates | Курс валют (USD/KZT = 530) |

#### Кампании и направления
| # | Таблица | Назначение |
|---|---------|------------|
| 3 | directions | Направления кампаний (Facebook + TikTok), бюджеты, CAPI, audience controls |
| 4 | direction_adsets | Адсеты в направлениях (Facebook) |
| 5 | direction_tiktok_adgroups | Ad groups в направлениях (TikTok) |

#### Креативы
| # | Таблица | Назначение |
|---|---------|------------|
| 6 | creatives | Загруженные креативы (video, image, carousel) + кеш метрик |
| 7 | generated_creatives | AI-сгенерированные креативы (Gemini) |
| 8 | direction_creative_gallery | Галерея креативов по направлению |
| 9 | creative_gallery_drafts | Черновики галереи |
| 10 | ad_creative_mapping | Связь ad_id → creative_id |

#### Метрики и скоринг
| # | Таблица | Назначение |
|---|---------|------------|
| 11 | metrics_history | Ежедневные метрики по адсетам (Facebook + TikTok) |
| 12 | creative_metrics_history | Детальные метрики по креативам (rankings, video metrics) |
| 13 | creative_scores | Risk scores и predictions (0-100, Low/Medium/High) |
| 14 | scoring_history | Health Score по адсетам (формула 45 + тренды + диагностика) |
| 15 | scoring_executions | Лог запусков скоринга |
| 16 | creative_tests | A/B тесты ($20 бюджет, 1000 показов, LLM-анализ) |

#### Лиды и продажи
| # | Таблица | Назначение |
|---|---------|------------|
| 17 | leads | Входящие лиды (UTM, CAPI tracking, CRM integration) |
| 18 | sales | Продажи (привязка к лидам, CRM) |
| 19 | purchases | Покупки / подписки |

#### WhatsApp и чатботы
| # | Таблица | Назначение |
|---|---------|------------|
| 20 | whatsapp_phone_numbers | Номера телефонов WhatsApp |
| 21 | whatsapp_instances | Подключения Evolution API |
| 22 | messages | Сообщения WhatsApp/чат |
| 23 | ai_bot_configurations | Настройки AI чатбота (prompt, schedule, operator pause, media) |
| 24 | ai_bot_functions | Функции бота (callable tools) |

#### CAPI (Conversion API)
| # | Таблица | Назначение |
|---|---------|------------|
| 25 | capi_settings | Настройки CAPI per channel (whatsapp, lead_forms, site) |
| 26 | capi_events_log | Лог событий CAPI (Lead, CompleteRegistration, Schedule) |

#### CRM интеграции
| # | Таблица | Назначение |
|---|---------|------------|
| 27 | amocrm_sync_log | Лог синхронизации AmoCRM |
| 28 | bitrix24_pipeline_stages | Стадии воронки Bitrix24 |
| 29 | bitrix24_status_history | История смены статусов Bitrix24 |
| 30 | bitrix24_sync_log | Лог синхронизации Bitrix24 |

#### Автопилот
| # | Таблица | Назначение |
|---|---------|------------|
| 31 | brain_executions | Лог выполнений автопилота (plan → actions → report) |
| 32 | pending_brain_proposals | Предложения semi-auto режима |

#### Уведомления
| # | Таблица | Назначение |
|---|---------|------------|
| 33 | user_notifications | Уведомления пользователю |
| 34 | notification_settings | Настройки уведомлений (лимиты, cooldowns) |
| 35 | notification_history | Лог доставки (telegram, in_app) |

#### Онбординг и память
| # | Таблица | Назначение |
|---|---------|------------|
| 36 | onboarding_history | История стадий онбординга |
| 37 | business_memory | Бизнес-контекст (key-value JSONB) |

#### Вебинары
| # | Таблица | Назначение |
|---|---------|------------|
| 38 | webinar_attendees | Участники вебинаров (Bizon365) |

Все CREATE TABLE с `IF NOT EXISTS`, INSERT с `ON CONFLICT DO NOTHING` — безопасно перезапускать.

### Миграция существующих клиентов

Для клиентов, созданных до schema v2, используй `migrate-existing.sql`:
```bash
# Один клиент
docker exec -i openclaw-postgres psql -U postgres -d openclaw_<slug> < db/migrate-existing.sql

# Все клиенты
for db in $(docker exec openclaw-postgres psql -U postgres -t -c "SELECT datname FROM pg_database WHERE datname LIKE 'openclaw_%' AND datname != 'openclaw'"); do
  echo "Migrating $db..."
  docker exec -i openclaw-postgres psql -U postgres -d "$db" < db/migrate-existing.sql
done
```

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
2. Применяет schema.sql (38 таблиц)
3. **Создаёт SaaS аккаунт** (если `SUPABASE_DB_URL` задан в .env):
   - `user_accounts` → `is_openclaw=true`, `openclaw_slug`
   - `ad_accounts` → привязка к пользователю
   - Сохраняет `saas_account_id`, `saas_ad_account_id`, `saas_db_url` в config
4. Создаёт workspace + **копирует** skills (не симлинка!)
5. Генерирует CLAUDE.md, TOOLS.md (подставляет slug) и openclaw.json
6. Генерирует gateway auth token
7. Устанавливает permissions (chown 1001:1001)
8. Запускает Docker контейнер с маппингом портов

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

### Синхронизация WhatsApp лидов

```bash
# Один клиент
./scripts/sync-leads.sh <slug>

# Все клиенты
./scripts/sync-leads.sh

# Cron (каждые 30 минут)
*/30 * * * * /home/openclaw/agents-monorepo/openclaw-standalone/scripts/sync-leads.sh >> /var/log/openclaw-sync.log 2>&1
```

## Сборка и запуск

### Первый запуск

```bash
cd /home/openclaw/agents-monorepo/openclaw-standalone

# Копировать и настроить .env
cp .env.example .env
# Отредактировать .env: SUPABASE_DB_URL, CHATBOT_SERVICE_URL

# Запуск PostgreSQL + Webhook + Upload + Evolution + Router + Redis
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

## Безопасность и логирование

### Структурированное логирование (JSON)

Все Node.js сервисы (`chatbot-router`, `webhook-service`) используют структурированный JSON-формат логов:
```json
{"ts":"2026-02-22T10:30:00.000Z","level":"info","msg":"Lead saved","slug":"test","leadgenId":"123","phone":"7701..."}
```

Уровни: `debug`, `info`, `warn`, `error`. Просмотр через `docker logs` + `jq`:
```bash
# Все ошибки chatbot-router
docker logs openclaw-chatbot-router 2>&1 | grep '"level":"error"' | jq .

# Лиды webhook-service
docker logs openclaw-webhook 2>&1 | grep '"msg":"Lead saved"' | jq .
```

### Защита от перегрузки

| Мера | chatbot-router | webhook-service |
|------|----------------|-----------------|
| Body size limit | 1 MB | 1 MB |
| Fetch timeout | 15s (SaaS forward) | 15s (Facebook API), 5s (Telegram) |
| Pool limit | 1 pool (SaaS), cache 500 instances | Max 50 tenant pools |
| Pool error handler | Да | Да |
| Graceful shutdown | SIGTERM/SIGINT, 10s force | SIGTERM/SIGINT, 10s force |

### SQL injection protection

- **webhook-service** — все SQL-запросы параметризованы (`$1`, `$2`, ...)
- **chatbot-router** — параметризованные запросы, CASE вместо строковой конкатенации
- **sync-leads.sh** — dollar-quoting (`$q$value$q$`) для всех полей из SaaS DB
- **create-client.sh** — slug валидирован regex `[a-z0-9_-]{1,30}`, dollar-quoting для password и DB URL

### Concurrency protection

- **sync-leads.sh** — lock file (`/tmp/sync-leads.lock`) предотвращает параллельный запуск cron

## Полезные команды

```bash
# Логи клиента
docker logs -f openclaw-<slug>

# Логи Evolution API
docker logs -f openclaw-evolution

# Логи chatbot-router
docker logs -f openclaw-chatbot-router

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

# Синхронизация WhatsApp лидов
./scripts/sync-leads.sh <slug>
```
