# WhatsApp Labels Service

Микросервис для автоматической простановки ярлыков квалифицированным лидам в WhatsApp Business через [whatsapp-web.js](https://github.com/nicholasrobinson/whatsapp-web.js), восстановления пропущенных сообщений, AI-квалификации лидов и атрибуции рекламных креативов.

## Зачем?

Facebook Ads оптимизирует показы на основе ярлыков из WhatsApp Business. Если помечать квалифицированных лидов ярлыком (например, "Оплачен") — FB ищет похожих людей и реклама лучше оптимизируется. Evolution API (Baileys) не может надёжно синхронизировать ярлыки с WhatsApp — они не появляются на телефоне. wwebjs эмулирует WhatsApp Web через Puppeteer/Chrome, и ярлыки реально синхронизируются.

## Четыре основные функции

### 1. AI-квалификация лидов (qualificationSync)
Анализирует **все** диалоги за последние N часов (по умолчанию 48ч, настраивается через `QUALIFICATION_WINDOW_HOURS`) через GPT-4o-mini и обновляет `is_qualified` и `is_paid` в таблице `leads`. Один вызов GPT определяет оба статуса.

- **Двухуровневая квалификация**: `is_qualified` (квалифицированный лид) + `is_paid` (оплатил/забронировал)
- `is_qualified` может меняться в обе стороны (false→true, true→false)
- `is_paid` **необратим** — однажды оплативший лид не понижается (защита от переанализа)
- Использует `prompt2` из `user_accounts` / `ad_accounts` (кастомные критерии клиента)
- Кастомный `prompt2` автоматически дополняется инструкцией про `is_paid`
- Фоллбэк на дефолтный промпт квалификации, если `prompt2` не задан
- Фоллбэк на Evolution DB для получения сообщений, когда `dialog_analysis.messages` = null
- Пороги уверенности: `QUALIFIED_CONFIDENCE_THRESHOLD` (по умолчанию 0.7), `PAID_CONFIDENCE_THRESHOLD` (по умолчанию 0.8)
- ~2500 tokens/диалог (GPT-4o-mini)

### 2. Автопростановка ярлыков (labelSync)
Проставляет WhatsApp-ярлыки через wwebjs. Поддерживает **два ярлыка** per аккаунт.

- **Проход 1**: квалифицированные лиды (`is_qualified = true`, `whatsapp_label_synced != true`) → `wwebjs_label_id_lead`
- **Проход 2**: оплатившие лиды (`is_paid = true`, `whatsapp_paid_label_synced != true`) → `wwebjs_label_id_paid`
- Одна wwebjs сессия на оба прохода (экономия RAM и времени)
- Paid-ярлык необязателен — если `wwebjs_label_id_paid` не настроен, Проход 2 пропускается
- Обратная совместимость: `wwebjs_label_id_lead` || `wwebjs_label_id` (старое поле)
- Sequential processing: максимум 1 Chrome (~300MB RAM), а не 20+ одновременно
- LocalAuth — сессия сохраняется на диск, повторный QR не нужен

### 3. Восстановление пропущенных сообщений (missedMessages)
Обнаруживает сообщения, которые не дошли до Evolution API, и пушит их в chatbot-service для ответа.

**Sync delay**: после подключения wwebjs ждёт 15 секунд (настраивается через `WWEBJS_SYNC_DELAY_MS`) перед `getChats()`, чтобы WhatsApp успел синхронизировать свежие timestamps чатов. Без задержки `getChats()` возвращает кешированные данные из LocalAuth с устаревшими timestamps, и все чаты отсеиваются фильтром по времени.

**CTWA-чаты (`@lid`)**: Click-to-WhatsApp чаты из рекламы Facebook/Instagram имеют формат `129089721643011@lid` (Facebook Lead ID вместо номера). Для таких чатов реальный номер телефона резолвится через `chat.getContact().number`. Если номер не удаётся извлечь — чат пропускается.

**Два типа пропусков:**
- **Полный пропуск**: чат есть в wwebjs, но в Evolution DB нет ни одного сообщения от контакта → первое сообщение не дошло вообще
- **Пропуск в диалоге**: чат есть в обеих системах, но в wwebjs больше входящих от клиента, чем в Evolution → некоторые сообщения потерялись

Использует прямые запросы к PostgreSQL Evolution API для сравнения.

**Диагностика**: в логах выводятся top-5 самых свежих chat timestamps и cutoff дата для отладки фильтрации.

### 4. Атрибуция рекламных креативов (adAttribution)
При recovery пропущенных сообщений извлекает рекламные метаданные из wwebjs и привязывает лид к конкретному креативу/направлению.

**Три паттерна атрибуции (по приоритету):**
1. **ctwa_context** — `rawData.ctwaContext.sourceId` (Click-to-WhatsApp context, основной для wwebjs). Также проверяет `contextInfo.externalAdReply` и `contextInfo.referral` как fallback
2. **url_match** — ссылка на Instagram/Facebook пост в тексте или `msg.links` (формат `instagram.com/p/...`, `instagram.com/reel/...`, `facebook.com/watch/...`)
3. **unattributed** — полный пропуск без метаданных → помечается как `wwebjs_unattributed` (лид с рекламы, но конкретный креатив неизвестен)

**Резолвинг креатива:**
- По `sourceId` → lookup в `ad_creative_mapping` → `creative_id` + `direction_id`
- По `sourceUrl` → fallback lookup в `user_creatives.title`
- Не перезаписывает существующую атрибуцию (`source_id` уже есть → пропуск)

**Поиск лида**: `findLead` ищет по `chat_id` в трёх форматах: голый номер (`77011345852`), `@s.whatsapp.net`, `@c.us` — т.к. в БД `chat_id` хранится без суффикса.

**Колонка `leads.ad_attribution_source`:**
- `evolution_webhook` — атрибуция через стандартный webhook Evolution API
- `wwebjs_recovery` — атрибуция через ctwaContext при recovery
- `wwebjs_url_match` — атрибуция по URL в тексте сообщения
- `wwebjs_unattributed` — лид с рекламы, но креатив неизвестен

## Принцип работы

1. **wwebjs = эмуляция WhatsApp Web** — запускает Chrome (Puppeteer), подключается как связанное устройство (по QR-коду при первом подключении)
2. **LocalAuth** — сессия сохраняется на диск, повторный QR не нужен после первого сканирования
3. **Sequential processing** — в любой момент максимум 1 активный Chrome (~300MB RAM), а не 20+ одновременно
4. **Два крона**:
   - **Ночной** (по умолчанию 03:00): квалификация → простановка ярлыков
   - **Каждый час**: восстановление пропущенных сообщений
5. **Взаимоисключение**: если одна задача работает, вторая пропускается

## Структура файлов

```
services/whatsapp-labels-service/
├── Dockerfile                    # node:18-bullseye + Chromium + tini
├── package.json
├── tsconfig.json
├── .gitignore
├── src/
│   ├── index.ts                  # Fastify сервер (порт 8089), регистрация роутов, запуск кронов
│   ├── lib/
│   │   ├── sessionManager.ts     # Управление wwebjs сессиями (init/destroy/get/checkAlive)
│   │   ├── labelSync.ts          # Логика простановки ярлыков через wwebjs
│   │   ├── qualificationSync.ts  # AI-квалификация диалогов через GPT-4o-mini
│   │   ├── missedMessages.ts     # Восстановление пропущенных сообщений (wwebjs vs Evolution DB)
│   │   ├── adAttribution.ts     # Извлечение ad-метаданных из wwebjs (ctwaContext, URL match)
│   │   ├── leadAttributionUpdater.ts # Обновление leads с атрибуцией + creative resolver
│   │   └── cronJob.ts            # Два крона + guard от параллельного запуска
│   └── routes/
│       ├── health.ts             # GET /health — статус сервиса
│       ├── qr.ts                 # POST/GET /qr/:userAccountId — генерация QR для подключения
│       ├── sessions.ts           # GET /sessions, GET /sessions/:id/labels, DELETE /sessions/:id
│       ├── sync.ts               # POST /sync, POST /sync/:userAccountId — ручной запуск ярлыков
│       ├── qualification.ts      # POST /qualification, POST /qualification/:userAccountId
│       └── recovery.ts           # POST /recovery, POST /recovery/:userAccountId
```

## API Endpoints

### Health
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Статус сервиса, количество активных сессий, реальное состояние WhatsApp (`waState: CONNECTED/UNPAIRED/...`) |

### QR (онбординг)
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/qr/:userAccountId` | Запустить сессию, получить QR-код для сканирования |
| GET | `/qr/:userAccountId` | Поллинг текущего статуса QR / подключения |

**Статусы**: `initializing` → `waiting_scan` (QR готов) → `connected`

### Sessions
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/sessions` | Список всех активных сессий |
| GET | `/sessions/:userAccountId/labels` | Получить список ярлыков WhatsApp |
| DELETE | `/sessions/:userAccountId` | Уничтожить сессию |

### Label Sync (ручной запуск)
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/sync` | Запустить синхронизацию ярлыков для всех аккаунтов (async) |
| POST | `/sync/:userAccountId` | Для одного аккаунта (блокирует, возвращает `{ synced, total }`) |

### Qualification (ручной запуск)
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/qualification` | Запустить квалификацию для всех аккаунтов (async) |
| POST | `/qualification/:userAccountId` | Для одного аккаунта (блокирует, возвращает `{ analyzed, qualified }`) |

### Missed Messages Recovery (ручной запуск)
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/recovery` | Запустить восстановление для всех аккаунтов (async) |
| POST | `/recovery/:userAccountId` | Для одного аккаунта (блокирует, возвращает `{ recovered }`) |

## Процесс ночного крона (03:00)

```
Шаг 1 — Квалификация (qualificationSync):
  1. Получить user_accounts где wwebjs_label_id_lead IS NOT NULL OR wwebjs_label_id IS NOT NULL
  2. Для каждого аккаунта:
     a. Получить dialog_analysis за последние N часов (QUALIFICATION_WINDOW_HOURS, incoming_count > 0)
     b. Если messages = null → фоллбэк на Evolution PostgreSQL
     c. Отправить переписку в GPT-4o-mini с prompt2 (+ дополнение про is_paid) или дефолтным промптом
     d. GPT возвращает {is_qualified, is_paid, confidence, paid_confidence, reasoning}
     e. is_qualified: confidence >= 0.7 → true, иначе false
     f. is_paid: paid_confidence >= 0.8 → true, иначе false. НЕОБРАТИМ: если уже true, не понижается
     g. UPDATE leads SET is_qualified, is_paid
     h. Пауза 500ms между запросами (rate limit OpenAI)

Шаг 2 — Простановка ярлыков (labelSync):
  1. Получить user_accounts где wwebjs_label_id_lead IS NOT NULL OR wwebjs_label_id IS NOT NULL
  2. Для каждого аккаунта последовательно:
     a. Инициализировать wwebjs сессию (Chrome + LocalAuth)
     b. Проверить checkSessionAlive() — если waState != CONNECTED → abort
     c. Проход 1 (Lead): leads с is_qualified=true, whatsapp_label_synced != true
        - chat.changeLabels([...existing, leadLabelId]) → markSynced
     d. Проход 2 (Paid): leads с is_paid=true, whatsapp_paid_label_synced != true
        - Пропускается если wwebjs_label_id_paid не настроен
        - chat.changeLabels([...existing, paidLabelId]) → markPaidSynced
     e. Пауза 1сек между ярлыками (rate limit)
     f. Уничтожить сессию (закрыть Chrome, освободить RAM)
```

## Процесс ежечасного крона (missedMessages + adAttribution)

```
1. Получить wwebjs-аккаунты с подключёнными инстансами Evolution
2. Для каждого аккаунта:
   a. Инициализировать wwebjs сессию
   b. Ждать WWEBJS_SYNC_DELAY_MS (15сек) — синхронизация timestamps с сервера WhatsApp
   c. Получить чаты с активностью за последние N часов (MISSED_MSG_MAX_AGE_HOURS)
   d. Лог диагностики: top-5 chat timestamps + cutoff дата
   e. Для каждого чата с входящими:
      - Если @lid чат (CTWA) → резолвить реальный номер через chat.getContact()
      - Тип 1 (полный пропуск): нет записей в Evolution DB →
        1) Извлечь ad-атрибуцию из сообщений (ctwaContext → URL match → unattributed)
        2) Push все входящие в chatbot
        3) Обновить лид: source_id, creative_id, direction_id, ad_attribution_source
      - Тип 2 (пропуск в диалоге): меньше входящих в Evolution чем в wwebjs →
        1) Извлечь ad-атрибуцию из пропущенных сообщений (без unattributed fallback)
        2) Push разницу в chatbot
        3) Обновить лид если найдены ad-метаданные
   f. Уничтожить сессию
```

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `PORT` | Порт HTTP сервера | `8089` |
| `SUPABASE_URL` | URL Supabase проекта | — (обязательно) |
| `SUPABASE_SERVICE_KEY` | Service role key Supabase | — (обязательно) |
| `OPENAI_API_KEY` | Ключ OpenAI для квалификации | — (квалификация отключена без ключа) |
| `CRON_SCHEDULE` | Расписание ночного крона | `0 3 * * *` (03:00) |
| `MISSED_MSG_CRON_SCHEDULE` | Расписание крона пропущенных сообщений | `0 * * * *` (каждый час) |
| `MISSED_MSG_MAX_AGE_HOURS` | Окно проверки пропущенных сообщений (часы) | `6` |
| `QUALIFICATION_WINDOW_HOURS` | Окно анализа диалогов для квалификации (часы) | `48` |
| `QUALIFIED_CONFIDENCE_THRESHOLD` | Минимальный confidence для квалификации (is_qualified) | `0.7` |
| `PAID_CONFIDENCE_THRESHOLD` | Минимальный confidence для оплаты (is_paid) | `0.8` |
| `INTEREST_MSG_THRESHOLD` | Минимум входящих сообщений для интереса | `3` |
| `CHATBOT_SERVICE_URL` | URL chatbot-service для push | `http://chatbot-service:8083` |
| `EVOLUTION_DB_HOST` | Хост PostgreSQL Evolution API | `evolution-postgres` |
| `EVOLUTION_DB_PORT` | Порт PostgreSQL Evolution API | `5432` |
| `EVOLUTION_DB_USER` | Пользователь БД Evolution | `evolution` |
| `EVOLUTION_DB_PASSWORD` | Пароль БД Evolution | — (recovery отключена без пароля) |
| `EVOLUTION_DB_NAME` | Имя БД Evolution | `evolution` |
| `WWEBJS_SYNC_DELAY_MS` | Задержка после ready перед getChats (мс) | `15000` |
| `PUPPETEER_EXECUTABLE_PATH` | Путь к Chromium | `/usr/bin/chromium` |

## Docker

```yaml
# docker-compose.yml
whatsapp-labels-service:
  build: ./services/whatsapp-labels-service
  container_name: whatsapp-labels-service
  ports:
    - "8089:8089"
  environment:
    - SUPABASE_URL=${SUPABASE_URL}
    - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
    - OPENAI_API_KEY=${OPENAI_API_KEY}
    - CRON_SCHEDULE=0 3 * * *
    - MISSED_MSG_CRON_SCHEDULE=0 * * * *
    - CHATBOT_SERVICE_URL=http://chatbot-service:8083
    - EVOLUTION_DB_HOST=evolution-postgres
    - EVOLUTION_DB_PASSWORD=${EVOLUTION_DB_PASSWORD}
  volumes:
    - wwebjs-sessions:/app/.wwebjs_auth
  restart: unless-stopped
```

Volume `wwebjs-sessions` хранит авторизационные данные сессий (LocalAuth). Без него потребуется повторное сканирование QR.

## Миграции БД

### `migrations/233_add_whatsapp_labels_fields.sql`

```sql
-- Поля для отслеживания синхронизации
ALTER TABLE leads ADD COLUMN whatsapp_label_synced BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN whatsapp_label_synced_at TIMESTAMPTZ;

-- Частичный индекс для быстрого поиска несинхронизированных лидов
CREATE INDEX idx_leads_label_sync ON leads (user_account_id)
  WHERE is_qualified = true
    AND (whatsapp_label_synced IS NULL OR whatsapp_label_synced = false)
    AND chat_id IS NOT NULL AND source_type = 'whatsapp';

-- ID ярлыка WhatsApp (настраивается через API)
ALTER TABLE user_accounts ADD COLUMN wwebjs_label_id TEXT;
```

### `migrations/241_optimization_escalation.sql`

```sql
-- Двухуровневая квалификация: is_paid + синхронизация paid-ярлыка
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_paid_label_synced BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_paid_label_synced_at TIMESTAMPTZ;

-- User accounts: два ярлыка (lead + paid)
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS wwebjs_label_id_lead TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS wwebjs_label_id_paid TEXT;

-- Миграция данных: wwebjs_label_id → wwebjs_label_id_lead
UPDATE user_accounts SET wwebjs_label_id_lead = wwebjs_label_id
WHERE wwebjs_label_id IS NOT NULL AND wwebjs_label_id_lead IS NULL;

-- Индекс для paid-лидов
CREATE INDEX IF NOT EXISTS idx_leads_paid_label_sync ON leads (user_account_id)
  WHERE is_paid = true
    AND (whatsapp_paid_label_synced IS NULL OR whatsapp_paid_label_synced = false)
    AND chat_id IS NOT NULL AND source_type = 'whatsapp';
```

### `migrations/234_add_ad_attribution_source.sql`

```sql
-- Источник атрибуции к рекламе (для отслеживания как лид был привязан к креативу)
-- Значения: evolution_webhook, wwebjs_recovery, wwebjs_url_match, wwebjs_unattributed
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ad_attribution_source TEXT;
```

## Фронтенд

Интеграция в `WhatsAppConnectionCard.tsx`:
- Кнопка **"Авто-ярлыки → Настроить"** открывает `WhatsAppLabelsDialog`
- 3-шаговый flow: QR-код → Выбор ярлыков → Готово
- **Два Select**: "Ярлык для квалифицированных лидов" (обязательный) + "Ярлык для оплативших клиентов" (необязательный)
- Paid-ярлык фильтруется — нельзя выбрать тот же что и lead-ярлык
- Сохраняется через `PUT /api/user-accounts/:id/wwebjs-label` с body `{ leadLabelId, paidLabelId }`
- Обратная совместимость: старый формат `{ labelId }` тоже работает

## Связь с Facebook Optimization Goal

WhatsApp-ярлыки напрямую влияют на оптимизацию Facebook Ads. При создании AdSet для WhatsApp-направлений доступны три `optimization_goal`:

| optimization_goal | Описание | Требования к ярлыкам |
|---|---|---|
| `CONVERSATIONS` | Оптимизация под начало переписки (стандарт) | Не требует ярлыков |
| `LEAD_GENERATION` | Оптимизация под квалифицированных лидов | Нужен lead-ярлык (`wwebjs_label_id_lead`) |
| `MESSAGING_PURCHASE_CONVERSION` | Оптимизация под покупки | Нужен paid-ярлык (`wwebjs_label_id_paid`) |

**Как это работает:**
1. Пользователь создаёт AdSet с нужным `optimization_goal` (через ManualLaunchDialog → Select "Оптимизация" или через Brain AI)
2. Facebook получает сигналы через ярлыки WhatsApp Business (механизм "передачи рекламных данных")
3. Facebook ищет похожих людей и оптимизирует показы

**Brain AI (зеркалирование):**
- Brain видит `optimization_goal` каждого AdSet в данных скоринга
- Если пользователь создал AdSet с `LEAD_GENERATION` и он показывает лучший CPL — Brain создаёт новые AdSet'ы с тем же goal
- Brain НЕ переключает goal самостоятельно если пользователь не создал ни одного AdSet с другим goal
- Параметр `optimization_goal_override` передаётся через `Direction.CreateAdSetWithCreatives`

**Все три goal'а могут сосуществовать в одной кампании** (направлении). Меняется только `optimization_goal` на AdSet, всё остальное (destination_type, promoted_object, креативы) идентично.

## Локальная разработка

```bash
cd services/whatsapp-labels-service
npm install
npm run dev  # tsx watch — автоперезапуск при изменениях
```

Для локальной разработки без Docker нужен установленный Chrome/Chromium:
```bash
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run dev
```

Для подключения к Evolution DB на проде через SSH-туннель:
```bash
ssh -L 5434:localhost:5433 root@147.182.186.15
# Затем: EVOLUTION_DB_HOST=localhost EVOLUTION_DB_PORT=5434
```

## Важные нюансы

- **Одно подключение = одно связанное устройство**. wwebjs занимает 1 слот из 4 доступных в WhatsApp.
- **Не конфликтует с Evolution API** — это отдельное подключение.
- **Диагностика сессий** — `/health` показывает реальное состояние WhatsApp (`waState: CONNECTED`). Перед sync проверяется `checkSessionAlive()` через `client.getState()`. Событие `change_state` логирует смену состояния (CONNECTED → UNPAIRED и т.д.).
- **Если сессия "сломалась"** — удалите директорию `.wwebjs_auth/session-{userAccountId}` и пересканируйте QR. Sync автоматически прервётся если сессия мёртвая (waState != CONNECTED).
- **Rate limiting** — между ярлыками пауза 1 секунда, между запросами OpenAI — 500ms.
- **Взаимоисключение кронов** — если ночная квалификация/ярлыки ещё работают, ежечасное восстановление пропускается (и наоборот).
- **Graceful degradation** — без `OPENAI_API_KEY` квалификация отключена; без `EVOLUTION_DB_PASSWORD` — recovery отключена; ярлыки работают всегда.
- **CTWA @lid чаты** — Click-to-WhatsApp чаты используют Facebook Lead ID вместо номера телефона (формат `129089721643011@lid`). Нельзя отправлять сообщения на Lead ID — нужно резолвить реальный номер через `chat.getContact()`.
- **Sync delay обязателен** — без задержки после `ready` wwebjs возвращает кешированные timestamps из LocalAuth. Все чаты выглядят "старыми" и отсеиваются фильтром `MISSED_MSG_MAX_AGE_HOURS`. По умолчанию 15 секунд.
- **Сборка перед деплоем** — Dockerfile копирует `dist/`, не `src/`. Перед `docker compose build` нужно запустить `npm run build` в директории сервиса.
