# Руководство по логированию и мониторингу

Документ описывает новую систему логирования и оповещений, внедрённую в `agents-monorepo`. Здесь собраны принципы работы, настройка окружения, способы просмотра логов и проверки алертов.

## 1. Архитектура

- **Pino + Fastify** — базовый JSON-логгер во всех сервисах (`agent-service`, `agent-brain`, `creative-analyzer`). Каждому HTTP-запросу автоматически присваивается `requestId`.
- **Promtail** — читает docker-логи сервисов и отправляет в Loki.
- **Loki** — централизованное хранилище логов.
- **Grafana** — визуализация и быстрый поиск по логам.
- **Telegram alerts worker** (`services/agent-brain/src/lib/logAlerts.js`) — периодически опрашивает Loki и отправляет ошибки в Telegram.
- **Error dictionary** (`services/agent-service/src/lib/facebookErrors.ts`) — перевод кодов Facebook Graph API в понятные сообщения и подсказки.

## 2. Структура логов

Каждая запись содержит минимум:

- `time` — ISO-время.
- `level` — `info`, `warn`, `error` и т.д.
- `service` — имя сервиса (`agent-service`, `agent-brain`, `creative-analyzer`).
- `environment` — `development`/`production` (берётся из `NODE_ENV`).
- `module` — подмодуль (например, `campaignBuilderRoutes`).
- `requestId` — уникальный ID HTTP-запроса.
- Контекст домена (добавляется автоматически в маршрутах):
  - `userAccountId` / `userAccountName` — идентификатор и имя клиента.
  - `directionId` / `directionName` — направление, с которым идёт работа.
  - `objective` — целевая метрика кампании.
  - Для `agent-brain` и `agent-service` контекст прикрепляется во всех HTTP-хендлерах, поэтому фильтр по пользователю работает в Grafana и Loki «из коробки».

Дополнительные поля, важные для Facebook-сценариев:

- `userTelegram`
- `fb.code` / `fb.error_subcode`
- `fbtrace_id`
- `resolution.short` и `resolution.hint`
- `resolutionSeverity` — значение `resolution.severity` вынесено в отдельную метку Loki для фильтров

Эти же поля используются при оформлении Telegram-уведомлений. Для креатив-тестов теперь добавлено логирование `force=true` и ручного удаления тестов (`DELETE /api/creative-test/:id`).

## 3. Переменные окружения

### Общие (пример — `.env.agent`, `.env.brain`)

| Переменная | Назначение |
|------------|-----------|
| `NODE_ENV` | `development` или `production`; влияет на уровень логов |
| `LOG_LEVEL` | Переопределяет уровень логирования (`debug`, `info`, `warn`, `error`) |

### Telegram-алерты (`agent-brain`)

| Переменная | Значение |
|------------|----------|
| `LOG_ALERT_TELEGRAM_BOT_TOKEN` | Токен боевого бота |
| `LOG_ALERT_TELEGRAM_CHAT_ID` | ID чата/канала |
| `LOG_ALERT_TEST_BOT_TOKEN` / `LOG_ALERT_TEST_CHAT_ID` | Fallback для тестов |
| `LOG_ALERT_POLL_INTERVAL_MS` | Интервал опроса Loki (мс, дефолт 30000) |
| `LOG_ALERT_DEDUP_WINDOW_MS` | Окно дедупликации (мс, дефолт 600000) |
| `LOG_ALERT_LOKI_ENVIRONMENT` | Фильтр по полю `environment` в логах |

### Loki / Promtail / Grafana

- Конфигурации лежат в `logging/` (файлы `loki-config.yml`, `promtail-config.yml`, `grafana-provisioning/...`).
- Grafana доступна на `http://localhost:3000` (логин/пароль по умолчанию `admin`/`admin`).

## 4. Запуск локально

```bash
docker compose up -d loki promtail grafana agent-service agent-brain creative-analyzer
```

Проверка сервисов:

- `curl http://localhost:8082/health` — `agent-service`
- `curl http://localhost:7080/api/brain/llm-ping` — `agent-brain`

Логи напрямую:

```bash
docker compose logs agent-service --tail 50
docker compose logs agent-brain --tail 50
```

### Обновление конфигурации Promtail

После правок в `logging/promtail-config.yml` перезапустите сервис, чтобы Promtail перечитал конфигурацию:

```bash
docker compose restart promtail
```

Через пару секунд убедитесь, что Loki видит новые лейблы. Пример запроса с функцией `label_values`:

```bash
curl "http://localhost:3100/loki/api/v1/query?query=label_values({job=\"docker-logs\"},%20\"userAccountId\")"
```

В ответе должен появиться список `userAccountId`, а аналогичные запросы для `directionId`, `directionName`, `objective` и `workflow` покажут значения из логов.

## 5. Просмотр логов

### Loki API

```bash
curl "http://localhost:3100/loki/api/v1/query?query={service=\"agent-service\",level=\"error\"}&limit=20"
```

Чтобы посмотреть ошибки конкретного клиента, добавьте фильтр по метке:

```bash
curl "http://localhost:3100/loki/api/v1/query?query={service=\"agent-service\",level=\"error\",userAccountId=\"<UUID>\"}&limit=50"
```

### Grafana

- Datasource Loki создаётся автоматически.
- Дашборд **Agent Services Overview** (папка *Logging*) — сводка по всем сервисам. Вверху доступны фильтры `service`, `module`, `userAccountId`; таблицы показывают последние ошибки, предупреждения и падения Graph API.
- Дашборд «Campaign Builder Errors» показывает агрегированные ошибки по направлениям и подсказки по их устранению.
- Дашборд **Campaign Builder Drilldown** — углублённый просмотр автозапусков и ручных запусков. Фильтры поддерживают `userAccountId`, `directionId`, `directionName`, `objective`, `workflow` и `resolutionSeverity`, чтобы легко отслеживать конкретные шаги и подсказки Facebook.
- Все дашборды используют одноимённые переменные Grafana; после обновления Promtail убедитесь, что выпадающие списки для `userAccountId`, `directionId`, `directionName`, `objective`, `workflow` и `resolutionSeverity` подхватили свежие значения.

#### После изменения лейблов в Promtail

1. Примените конфигурацию: `docker compose restart promtail`.
2. Проверьте, что агент поднялся без ошибок: `docker compose logs promtail --tail 20`.
3. Убедитесь, что Loki видит новые лейблы: в Grafana Explore выполните `label_values({service="agent-service"}, userAccountId)` или запрос `curl "http://localhost:3100/loki/api/v1/labels"`.
4. Обновите переменные на дашбордах (**Dashboard settings → Variables → Update**), чтобы выпадающие списки `userAccountId`, `directionId`, `directionName`, `objective`, `workflow` и `resolutionSeverity` подхватили новые значения.
- Дашборд «Campaign Builder Errors» показывает ошибки, их количество и подсказки.
- Дашборды «Agent Services Overview» и «Campaign Builder Drilldown» используют переменные `userAccountId`, `directionId`, `directionName`, `objective` и `workflow` — после обновления Promtail проверьте, что выпадающие списки подхватывают свежие значения и панели фильтруются по выбранным лейблам.
- Можно применять фильтры по `userAccountId`, `directionId`, `directionName`, `objective`, `workflow`, `module`, `resolution.severity` (все поля подтягиваются как одноимённые лейблы в Loki).

## 6. Telegram-уведомления

Процесс:

1. Воркер `agent-brain` каждые `LOG_ALERT_POLL_INTERVAL_MS` запрашивает Loki (уровень error).
2. Фильтрует по `environment`.
3. Дедуплицирует события и отправляет сообщение в Telegram (MarkdownV2).

Пример уведомления:

```
❗️ Ошибка в сервисе
Сервис: agent-service
Модуль: campaignBuilderRoutes
Сообщение: Failed to build campaign action
UserAccount: 0f559eb0-...5864b
Имя: performante
Facebook code: 190/—
Решение: Сессия Facebook истекла. Нужна повторная авторизация в рекламном кабинете.
Hint: Попросите клиента залогиниться заново и обновить токен доступа.
requestId: 2f1...
```

### Тест

1. Заполнить `LOG_ALERT_TEST_BOT_TOKEN` и `LOG_ALERT_TEST_CHAT_ID` (или боевые).
2. Сгенерировать ошибку (например, вызвать `auto-launch` без токена).
3. Убедиться, что сообщение пришло в чат.

## 7. Если Telegram недоступен

- Используйте Grafana (через поддомен или SSH-туннель `ssh -L 3000:localhost:3000 user@host`).
- Смотрите логи напрямую через `docker compose logs`.

## 8. Частые проблемы

| Симптом | Причина | Решение |
|---------|---------|---------|
| `LOG_ALERT_TELEGRAM_* env not set; alerts disabled` | Нет токена/ID | Заполнить `.env.brain` |
| `supabase not configured` в `agent-brain` | Пустой `SUPABASE_URL` в локальном `.env.brain` | Подставить URL из продакшена или `.env.brain.bak` |
| Promtail `timestamp too old` | Старые docker-логи | Перезапустить Docker Desktop |
| `fetch failed: ETIMEDOUT` к Facebook API | Особенности сети Docker Desktop | Локальное ограничение, в проде не воспроизводится |

## 9. Словарь ошибок

- Файл: `services/agent-service/src/lib/facebookErrors.ts`.
- Добавляйте новые коды в формате `'code:subcode'`.
- Поля: `short`, `hint`, `severity` (`warning` или `error`).

## 10. Дополнительные советы

- При добавлении сервисов используйте общий `logger` (через `createLogger`).
- В логах всегда добавляйте `userAccountId`, `userAccountName`, `userTelegram`. Для HTTP-роутов `campaignBuilderRoutes` и `agent-brain` это делается автоматически, но при логировании из вспомогательных модулей (например, при прямой работе с Facebook API) передавайте контекст через `log.child` или параметр `logContext`.
- Перед деплоем проверяйте:
  - `docker compose logs promtail --tail 20`
  - `curl http://localhost:3100/metrics`
  - `curl http://localhost:7080/api/brain/llm-ping`

---

Дальнейшие улучшения (mute по severity, команды боту, отчётность) зафиксированы в backlog.


