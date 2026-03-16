# WhatsApp Labels Service

Микросервис для автоматической простановки ярлыков квалифицированным лидам в WhatsApp Business через [whatsapp-web.js](https://github.com/nicholasrobinson/whatsapp-web.js).

## Зачем?

Facebook Ads оптимизирует показы на основе ярлыков из WhatsApp Business. Если помечать квалифицированных лидов ярлыком (например, "Оплачен") — FB ищет похожих людей и реклама лучше оптимизируется. Evolution API (Baileys) не может надёжно синхронизировать ярлыки с WhatsApp — они не появляются на телефоне. wwebjs эмулирует WhatsApp Web через Puppeteer/Chrome, и ярлыки реально синхронизируются.

## Принцип работы

1. **wwebjs = эмуляция WhatsApp Web** — запускает Chrome (Puppeteer), подключается как связанное устройство (по QR-коду при первом подключении)
2. **LocalAuth** — сессия сохраняется на диск, повторный QR не нужен после первого сканирования
3. **Sequential processing** — в любой момент максимум 1 активный Chrome (~300MB RAM), а не 20+ одновременно
4. **Ночной крон** (по умолчанию 03:00) — обходит всех клиентов последовательно: инициализирует сессию → проставляет ярлыки → закрывает сессию → следующий клиент

## Структура файлов

```
services/whatsapp-labels-service/
├── Dockerfile                    # node:18-bullseye + Chromium + tini
├── package.json
├── tsconfig.json
├── .gitignore
├── src/
│   ├── index.ts                  # Fastify сервер (порт 8089), регистрация роутов, запуск крона
│   ├── lib/
│   │   ├── sessionManager.ts     # Управление wwebjs сессиями (init/destroy/get)
│   │   ├── labelSync.ts          # Основная логика: Supabase → лиды → ярлыки → update
│   │   └── cronJob.ts            # Ночной крон (node-cron), guard от параллельного запуска
│   └── routes/
│       ├── health.ts             # GET /health — статус сервиса
│       ├── qr.ts                 # POST/GET /qr/:userAccountId — генерация QR для подключения
│       ├── sessions.ts           # GET /sessions, GET /sessions/:id/labels, DELETE /sessions/:id
│       └── sync.ts               # POST /sync, POST /sync/:userAccountId — ручной запуск
```

## API Endpoints

### Health
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Статус сервиса, количество активных сессий |

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
| GET | `/sessions/:userAccountId/labels` | Получить список ярлыков WhatsApp (инициализирует сессию, забирает ярлыки, закрывает) |
| DELETE | `/sessions/:userAccountId` | Уничтожить сессию |

### Sync (ручной запуск)
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/sync` | Запустить синхронизацию для всех аккаунтов (async, не блокирует) |
| POST | `/sync/:userAccountId` | Запустить синхронизацию для одного аккаунта (блокирует, возвращает результат) |

## Процесс синхронизации ярлыков

```
1. Получить user_accounts где wwebjs_label_id IS NOT NULL
2. Для каждого аккаунта последовательно:
   a. Получить leads из Supabase:
      - source_type = 'whatsapp'
      - is_qualified = true ИЛИ reached_key_stage = true
      - whatsapp_label_synced != true
      - chat_id IS NOT NULL
   b. Инициализировать wwebjs сессию (Chrome + LocalAuth)
   c. Для каждого лида:
      - Конвертировать chat_id → формат wwebjs ("77768712233@c.us")
      - client.getChatById(chatId)
      - chat.getLabels() → chat.changeLabels([...existing, labelId])
      - UPDATE leads SET whatsapp_label_synced = true
      - Пауза 1сек между лидами (rate limit)
   d. Уничтожить сессию (закрыть Chrome, освободить RAM)
```

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `PORT` | Порт HTTP сервера | `8089` |
| `SUPABASE_URL` | URL Supabase проекта | — (обязательно) |
| `SUPABASE_SERVICE_KEY` | Service role key Supabase | — (обязательно) |
| `CRON_SCHEDULE` | Расписание крона (cron expression) | `0 3 * * *` (03:00) |
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
    - CRON_SCHEDULE=0 3 * * *
  volumes:
    - wwebjs-sessions:/app/.wwebjs_auth
  restart: unless-stopped
```

Volume `wwebjs-sessions` хранит авторизационные данные сессий (LocalAuth). Без него потребуется повторное сканирование QR.

## Миграция БД

Файл: `migrations/233_add_whatsapp_labels_fields.sql`

```sql
-- Поля для отслеживания синхронизации
ALTER TABLE leads ADD COLUMN whatsapp_label_synced BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN whatsapp_label_synced_at TIMESTAMPTZ;

-- Частичный индекс для быстрого поиска несинхронизированных лидов
CREATE INDEX idx_leads_label_sync ON leads (user_account_id)
  WHERE (is_qualified = true OR reached_key_stage = true)
    AND (whatsapp_label_synced IS NULL OR whatsapp_label_synced = false)
    AND chat_id IS NOT NULL AND source_type = 'whatsapp';

-- ID ярлыка WhatsApp (настраивается через фронтенд)
ALTER TABLE user_accounts ADD COLUMN wwebjs_label_id TEXT;
```

## Фронтенд

Интеграция в `WhatsAppConnectionCard.tsx`:
- Кнопка **"Авто-ярлыки → Настроить"** открывает `WhatsAppLabelsDialog`
- 3-шаговый flow: QR-код → Выбор ярлыка → Готово
- Выбранный `labelId` сохраняется в `user_accounts.wwebjs_label_id` через `PUT /api/user-accounts/:id/wwebjs-label`

## Локальная разработка

```bash
cd services/whatsapp-labels-service
npm install
npm run dev  # tsx watch — автоперезапуск при изменениях
```

Для локальной разработки без Docker нужен установленный Chrome/Chromium. Укажите путь:
```bash
PUPPETEER_EXECUTABLE_PATH=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome npm run dev
```

## Важные нюансы

- **Одно подключение = одно связанное устройство**. wwebjs занимает 1 слот из 4 доступных в WhatsApp.
- **Не конфликтует с Evolution API** — это отдельное подключение.
- **Если сессия "сломалась"** — удалите директорию `.wwebjs_auth/session-{userAccountId}` и пересканируйте QR.
- **Rate limiting** — между ярлыками пауза 1 секунда. WhatsApp может заблокировать при слишком агрессивном использовании.
