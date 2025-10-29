# Команды для работы с логами (All Services)

> **Создано:** 2025-10-29
> **Назначение:** Полный справочник команд для просмотра логов всех компонентов системы agents-monorepo

---

## Содержание

1. [Быстрый доступ (Quick Access)](#быстрый-доступ-quick-access)
2. [Основные сервисы (Main Services)](#основные-сервисы-main-services)
3. [Инфраструктурные сервисы (Infrastructure)](#инфраструктурные-сервисы-infrastructure)
4. [WhatsApp Integration (Evolution API)](#whatsapp-integration-evolution-api)
5. [Grafana & Loki (Centralized Logs)](#grafana--loki-centralized-logs)
6. [Фильтрация и поиск (Filtering)](#фильтрация-и-поиск-filtering)
7. [Полезные комбинации (Useful Combos)](#полезные-комбинации-useful-combos)
8. [Troubleshooting (Поиск проблем)](#troubleshooting-поиск-проблем)
9. [Экспорт и сохранение логов](#экспорт-и-сохранение-логов)

---

## Быстрый доступ (Quick Access)

### Все сервисы сразу

```bash
# Все логи в режиме реального времени
docker-compose logs -f

# Все логи за последние 100 строк
docker-compose logs --tail=100

# Все логи с timestamp
docker-compose logs -f --timestamps

# Все логи без цветовой подсветки (для экспорта)
docker-compose logs --no-color > all-logs.txt
```

### Проверка статуса всех контейнеров

```bash
# Статус всех контейнеров
docker-compose ps

# Детальный статус
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Только работающие контейнеры
docker ps --filter "status=running"
```

### Health Check всех сервисов

```bash
# agent-service
curl http://localhost:8082/health

# agent-brain
curl http://localhost:7080/api/brain/llm-ping

# Loki
curl http://localhost:3100/ready

# Grafana
curl http://localhost:3000/api/health

# Evolution API
curl http://localhost:8080/manager/status

# N8N
curl http://localhost:5678/healthz
```

---

## Основные сервисы (Main Services)

### 1. agent-service (Backend API)

**Порт:** 8082
**Технология:** Fastify + TypeScript + Pino
**Назначение:** Backend API для Facebook/WhatsApp, Campaign Builder

#### Базовые команды

```bash
# Реал-тайм логи (последние 50 строк + follow)
docker-compose logs -f --tail=50 agent-service

# Только последние 100 строк
docker-compose logs --tail=100 agent-service

# С timestamp
docker-compose logs -f --timestamps agent-service

# Логи за последний час (требует доступ к Loki)
docker logs agents-monorepo-agent-service-1 --since 1h
```

#### Детализированные логи (Debug level)

```bash
# Логи с уровнем DEBUG (если установлен LOG_LEVEL=debug)
docker-compose logs -f agent-service | grep -E '"level":(10|20|30|40|50|60)'

# Только DEBUG сообщения (level 20)
docker-compose logs -f agent-service | grep '"level":20'

# Только INFO и выше (level 30+)
docker-compose logs -f agent-service | grep -E '"level":(30|40|50|60)'
```

#### Поиск по ключевым словам

```bash
# Поиск ошибок
docker-compose logs agent-service | grep -i error

# Поиск по пользователю
docker-compose logs agent-service | grep "userAccountId"

# Поиск по requestId
docker-compose logs agent-service | grep "requestId.*abc123"

# Campaign Builder логи
docker-compose logs -f agent-service | grep -i "campaign"

# Facebook API запросы
docker-compose logs -f agent-service | grep -i "facebook\|fb_"

# WhatsApp логи
docker-compose logs -f agent-service | grep -i "whatsapp\|evolution"
```

#### Экспорт логов

```bash
# Сохранить последние 1000 строк в файл
docker-compose logs --tail=1000 agent-service > agent-service-logs.txt

# Сохранить за последний час
docker logs agents-monorepo-agent-service-1 --since 1h > agent-service-1h.log

# JSON формат (для анализа)
docker logs agents-monorepo-agent-service-1 --tail=500 | grep '^{' > agent-service.json
```

---

### 2. agent-brain (Scoring & Optimization Agent)

**Порт:** 7080
**Технология:** Node.js + Fastify + Pino
**Назначение:** Scoring agent, campaign optimization, cron jobs, Telegram alerts

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 agent-brain

# Последние 200 строк
docker-compose logs --tail=200 agent-brain

# С timestamp
docker-compose logs -f --timestamps agent-brain
```

#### Детализированные логи

```bash
# DEBUG level (если LOG_LEVEL=debug)
docker-compose logs -f agent-brain | grep '"level":20'

# Все уровни логирования
docker-compose logs -f agent-brain | grep -E '"level":(10|20|30|40|50|60)'

# Только ERROR и FATAL
docker-compose logs -f agent-brain | grep -E '"level":(50|60)'
```

#### Специфичные для agent-brain

```bash
# Scoring процесс
docker-compose logs -f agent-brain | grep -i "scoring\|processUser\|batch"

# LLM запросы (OpenRouter)
docker-compose logs -f agent-brain | grep -i "llm\|openrouter\|openai"

# Creative Analyzer
docker-compose logs -f agent-brain | grep -i "analyzer\|creative"

# Cron job выполнение
docker-compose logs -f agent-brain | grep -i "cron\|schedule"

# Telegram alerts
docker-compose logs -f agent-brain | grep -i "telegram\|alert\|notification"

# LogAlerts worker
docker-compose logs -f agent-brain | grep -i "logAlerts\|poll"
```

#### Поиск ошибок

```bash
# Все ошибки
docker-compose logs agent-brain | grep -i error

# Ошибки API
docker-compose logs agent-brain | grep -i "api error\|fetch failed"

# Ошибки базы данных
docker-compose logs agent-brain | grep -i "database\|postgres\|query failed"

# Ошибки LLM
docker-compose logs agent-brain | grep -i "llm error\|openrouter error"
```

#### Экспорт

```bash
# Сохранить последние 2000 строк
docker-compose logs --tail=2000 agent-brain > agent-brain-logs.txt

# За последние 2 часа
docker logs agents-monorepo-agent-brain-1 --since 2h > agent-brain-2h.log

# Только ошибки
docker-compose logs agent-brain | grep -i error > agent-brain-errors.txt
```

---

### 3. creative-analyzer (LLM Creative Analysis)

**Порт:** 7081
**Технология:** Node.js + Fastify + Pino
**Назначение:** LLM-based creative analysis service (использует тот же код, что agent-brain)

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 creative-analyzer

# Последние 100 строк
docker-compose logs --tail=100 creative-analyzer
```

#### Специфичные логи

```bash
# LLM анализ креативов
docker logs agents-monorepo-creative-analyzer-1 | grep -i "analyze\|creative\|llm"

# Ошибки анализа
docker logs agents-monorepo-creative-analyzer-1 | grep -i error

# Запросы к OpenRouter
docker logs agents-monorepo-creative-analyzer-1 | grep -i "openrouter\|gpt-4"
```

**Примечание:** creative-analyzer использует тот же код, что и agent-brain, поэтому многие команды идентичны.

---

### 4. Frontend (Production UI)

**Порт:** 3001 (внутри контейнера: 80)
**Технология:** React + Vite
**Домен:** app.performanteaiagency.com

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 frontend

# Последние 100 строк
docker-compose logs --tail=100 frontend

# С timestamp
docker-compose logs -f --timestamps frontend
```

#### Nginx access логи (внутри контейнера)

```bash
# Если используется встроенный nginx
docker exec agents-monorepo-frontend-1 cat /var/log/nginx/access.log | tail -50

# Error логи nginx
docker exec agents-monorepo-frontend-1 cat /var/log/nginx/error.log
```

#### Поиск проблем

```bash
# Ошибки сборки Vite
docker-compose logs frontend | grep -i "error\|failed"

# Проблемы с роутингом
docker-compose logs frontend | grep -i "404\|not found"
```

---

### 5. Frontend-AppReview (App Review UI)

**Порт:** 3002 (внутри контейнера: 80)
**Технология:** React + Vite
**Домен:** performanteaiagency.com

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 frontend-appreview

# Последние 100 строк
docker-compose logs --tail=100 frontend-appreview

# С timestamp
docker-compose logs -f --timestamps frontend-appreview
```

#### Отличия от production frontend

```bash
# Поиск различий в сборке (BUILD_MODE=appreview)
docker-compose logs frontend-appreview | grep -i "build mode\|appreview"

# Проверка ограничений для App Review
docker-compose logs frontend-appreview | grep -i "feature flag\|disabled"
```

---

## Инфраструктурные сервисы (Infrastructure)

### 1. Nginx (Reverse Proxy)

**Порт:** 80, 443
**Технология:** Nginx Alpine
**Назначение:** Reverse proxy, SSL termination, маршрутизация доменов

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 nginx

# Последние 200 строк
docker-compose logs --tail=200 nginx

# С timestamp
docker-compose logs -f --timestamps nginx
```

#### Access логи

```bash
# Все HTTP запросы
docker-compose logs nginx | grep -E 'GET|POST|PUT|DELETE|PATCH'

# Только ошибки 4xx, 5xx
docker-compose logs nginx | grep -E '" (4[0-9]{2}|5[0-9]{2}) '

# Запросы к конкретному домену
docker-compose logs nginx | grep "app.performanteaiagency.com"

# SSL/TLS ошибки
docker-compose logs nginx | grep -i "ssl\|certificate"
```

#### Детальный анализ

```bash
# Медленные запросы (если логируется время ответа)
docker-compose logs nginx | grep -E 'upstream_response_time: [1-9]'

# Проблемы с upstream сервисами
docker-compose logs nginx | grep -i "upstream\|backend\|proxy"

# Запросы к API
docker-compose logs nginx | grep "/api/"
```

#### Экспорт access логов

```bash
# Все access логи в файл
docker-compose logs --tail=5000 nginx > nginx-access.log

# Только ошибки
docker-compose logs nginx | grep -i error > nginx-errors.log
```

---

### 2. Loki (Log Aggregation)

**Порт:** 3100
**Технология:** Grafana Loki 2.9.1
**Назначение:** Централизованная агрегация логов

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 loki

# Последние 100 строк
docker-compose logs --tail=100 loki
```

#### Проверка работоспособности

```bash
# Healthcheck
curl http://localhost:3100/ready

# Метрики
curl http://localhost:3100/metrics

# Конфигурация
curl http://localhost:3100/config
```

#### Прямые запросы к Loki API

```bash
# Последние ERROR логи из agent-service
curl -G "http://localhost:3100/loki/api/v1/query" \
  --data-urlencode 'query={service="agent-service",level="error"}' \
  --data-urlencode 'limit=20'

# Логи за последний час
curl -G "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={environment="production"}' \
  --data-urlencode 'start='$(date -u -d '1 hour ago' +%s)000000000 \
  --data-urlencode 'end='$(date -u +%s)000000000

# Все сервисы с ошибками
curl -G "http://localhost:3100/loki/api/v1/query" \
  --data-urlencode 'query={level="error"}' \
  --data-urlencode 'limit=50' | jq '.data.result'

# Логи конкретного пользователя
curl -G "http://localhost:3100/loki/api/v1/query" \
  --data-urlencode 'query={userAccountId="123"}' \
  --data-urlencode 'limit=100'
```

#### Поиск проблем Loki

```bash
# Ошибки ingestion
docker-compose logs loki | grep -i "ingestion\|failed to push"

# Проблемы с хранилищем
docker-compose logs loki | grep -i "storage\|chunk"

# Проблемы с памятью
docker-compose logs loki | grep -i "memory\|oom"
```

---

### 3. Promtail (Log Collector)

**Порт:** 9080
**Технология:** Grafana Promtail 2.9.1
**Назначение:** Сбор логов из Docker и отправка в Loki

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 promtail

# Последние 100 строк
docker-compose logs --tail=100 promtail
```

#### Проверка работы

```bash
# Метрики Promtail
curl http://localhost:9080/metrics

# Targets (какие файлы собираются)
curl http://localhost:9080/targets
```

#### Поиск проблем

```bash
# Ошибки отправки в Loki
docker-compose logs promtail | grep -i "failed to send\|error pushing"

# Проблемы с парсингом логов
docker-compose logs promtail | grep -i "parsing\|invalid"

# Проблемы с доступом к Docker socket
docker-compose logs promtail | grep -i "docker\|permission denied"
```

---

### 4. Grafana (Log Visualization)

**Порт:** 3000
**Технология:** Grafana 10.4.3
**Назначение:** Визуализация логов, дашборды

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 grafana

# Последние 100 строк
docker-compose logs --tail=100 grafana
```

#### Проверка работы

```bash
# Health check
curl http://localhost:3000/api/health

# Проверка datasource
curl -u admin:admin http://localhost:3000/api/datasources
```

#### Веб-интерфейс

```bash
# Открыть в браузере
open http://localhost:3000

# Логин по умолчанию: admin / admin
```

#### Поиск проблем

```bash
# Ошибки подключения к Loki
docker-compose logs grafana | grep -i "loki\|datasource"

# Проблемы с плагинами
docker-compose logs grafana | grep -i "plugin"

# Ошибки авторизации
docker-compose logs grafana | grep -i "auth\|login"
```

---

## WhatsApp Integration (Evolution API)

### 1. evolution-api (WhatsApp Business API)

**Порт:** 8080
**Технология:** Evolution API v2.3.6 + Baileys 7.0.0-rc.6
**Назначение:** WhatsApp Business API integration

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 evolution-api

# Последние 200 строк (WhatsApp может быть многословным)
docker-compose logs --tail=200 evolution-api

# С timestamp
docker-compose logs -f --timestamps evolution-api
```

#### Детализированные логи

```bash
# Логи Baileys (WhatsApp протокол)
docker-compose logs -f evolution-api | grep -i "baileys"

# Логи подключения к WhatsApp
docker-compose logs -f evolution-api | grep -i "connection\|qr\|auth"

# Логи отправки сообщений
docker-compose logs -f evolution-api | grep -i "sendMessage\|messageUpsert"

# Логи получения сообщений
docker-compose logs -f evolution-api | grep -i "message\|incoming"

# Webhook события
docker-compose logs -f evolution-api | grep -i "webhook"
```

#### Поиск проблем

```bash
# Ошибки подключения
docker-compose logs evolution-api | grep -i "connection failed\|disconnect"

# Проблемы с БД
docker-compose logs evolution-api | grep -i "postgres\|database"

# Проблемы с Redis
docker-compose logs evolution-api | grep -i "redis\|cache"

# Rate limiting
docker-compose logs evolution-api | grep -i "rate limit\|429"

# Banned/Blocked
docker-compose logs evolution-api | grep -i "banned\|blocked"
```

#### API проверки

```bash
# Статус сервера
curl http://localhost:8080/manager/status

# Список инстансов
curl -H "apikey: YOUR_API_KEY" http://localhost:8080/instance/fetchInstances

# Статус подключения конкретного инстанса
curl -H "apikey: YOUR_API_KEY" http://localhost:8080/instance/connectionState/INSTANCE_NAME
```

---

### 2. evolution-redis (Cache)

**Порт:** 6380
**Технология:** Redis 7-Alpine

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 evolution-redis

# Последние 100 строк
docker-compose logs --tail=100 evolution-redis
```

#### Проверка работы Redis

```bash
# Ping Redis
docker exec agents-monorepo-evolution-redis-1 redis-cli -p 6380 ping

# Информация о Redis
docker exec agents-monorepo-evolution-redis-1 redis-cli -p 6380 INFO

# Статистика памяти
docker exec agents-monorepo-evolution-redis-1 redis-cli -p 6380 INFO memory

# Количество ключей
docker exec agents-monorepo-evolution-redis-1 redis-cli -p 6380 DBSIZE
```

---

### 3. evolution-postgres (Database)

**Порт:** 5433
**Технология:** PostgreSQL 15-Alpine

#### Базовые команды

```bash
# Реал-тайм логи
docker-compose logs -f --tail=50 evolution-postgres

# Последние 100 строк
docker-compose logs --tail=100 evolution-postgres
```

#### Проверка работы PostgreSQL

```bash
# Подключиться к БД
docker exec -it agents-monorepo-evolution-postgres-1 psql -U postgres -d evolution

# Список таблиц
docker exec agents-monorepo-evolution-postgres-1 psql -U postgres -d evolution -c "\dt"

# Размер БД
docker exec agents-monorepo-evolution-postgres-1 psql -U postgres -d evolution -c "SELECT pg_size_pretty(pg_database_size('evolution'));"
```

#### Поиск проблем

```bash
# Ошибки SQL
docker-compose logs evolution-postgres | grep -i "error\|fatal"

# Медленные запросы
docker-compose logs evolution-postgres | grep -i "duration:"

# Проблемы с подключениями
docker-compose logs evolution-postgres | grep -i "connection\|authentication"
```

---

## Grafana & Loki (Centralized Logs)

### LogQL запросы через Grafana

Откройте Grafana: http://localhost:3000

#### Базовые LogQL запросы

```logql
# Все логи agent-service
{service="agent-service"}

# Только ошибки
{level="error"}

# Ошибки конкретного сервиса
{service="agent-brain", level="error"}

# Логи по пользователю
{userAccountId="123"}

# Логи по requestId
{requestId="abc-123"}

# Логи за последний час
{service="agent-service"} |= "error" [1h]

# Логи с фильтрацией по тексту
{service="agent-service"} |= "Campaign Builder"

# Исключить определенные логи
{service="agent-service"} != "health check"

# Регулярное выражение
{service="agent-service"} |~ "error|failed|exception"
```

#### Продвинутые LogQL запросы

```logql
# Подсчет ошибок по сервисам
sum by (service) (count_over_time({level="error"}[1h]))

# Rate ошибок (ошибки в секунду)
rate({level="error"}[5m])

# Топ 10 пользователей с ошибками
topk(10, sum by (userAccountId) (count_over_time({level="error"}[24h])))

# Логи с извлечением JSON полей
{service="agent-service"} | json | line_format "{{.message}} - User: {{.userAccountId}}"

# Фильтрация по JSON полю
{service="agent-service"} | json | userAccountId = "123"

# Логи с duration > 1000ms
{service="agent-service"} | json | duration > 1000
```

---

## Фильтрация и поиск (Filtering)

### Grep фильтры

#### Поиск ошибок

```bash
# Все ошибки (case-insensitive)
docker-compose logs -f | grep -i error

# Только ERROR level из Pino
docker-compose logs -f | grep '"level":50'

# Ошибки с контекстом (3 строки до и после)
docker-compose logs | grep -i -B3 -A3 error

# Несколько типов ошибок
docker-compose logs | grep -E 'error|fail|exception|fatal'
```

#### Поиск по пользователю

```bash
# По userAccountId
docker-compose logs -f | grep "userAccountId"

# Конкретный пользователь
docker-compose logs | grep "userAccountId.*123"

# По имени пользователя
docker-compose logs | grep "userAccountName.*John"
```

#### Поиск по времени

```bash
# Логи за последний час
docker logs agents-monorepo-agent-service-1 --since 1h

# Логи за последние 30 минут
docker logs agents-monorepo-agent-brain-1 --since 30m

# Логи с определенного времени
docker logs agents-monorepo-nginx-1 --since 2025-10-29T10:00:00

# Логи между временными метками
docker logs agents-monorepo-agent-service-1 --since 2025-10-29T10:00:00 --until 2025-10-29T11:00:00
```

#### Поиск по requestId

```bash
# Трейсинг запроса через все логи
docker-compose logs | grep "requestId.*abc-123-def"

# В конкретном сервисе
docker-compose logs agent-service | grep "requestId"
```

---

### Комбинированные фильтры

```bash
# Ошибки agent-service за последний час
docker logs agents-monorepo-agent-service-1 --since 1h | grep -i error

# INFO и выше для agent-brain
docker-compose logs -f agent-brain | grep -E '"level":(30|40|50|60)'

# Логи конкретного пользователя с ошибками
docker-compose logs | grep "userAccountId.*123" | grep -i error

# Campaign Builder ошибки
docker-compose logs -f agent-service | grep -i "campaign" | grep -i error

# WhatsApp сообщения с ошибками
docker-compose logs -f evolution-api | grep -i "message" | grep -i error
```

---

## Полезные комбинации (Useful Combos)

### Мониторинг в режиме реального времени

```bash
# Два терминала: agent-service + agent-brain
# Terminal 1:
docker-compose logs -f agent-service | grep -E 'error|warn'

# Terminal 2:
docker-compose logs -f agent-brain | grep -E 'error|warn'
```

```bash
# Все ошибки со всех сервисов
docker-compose logs -f | grep -E '"level":(40|50|60)'

# Мониторинг конкретного flow (Campaign Builder)
docker-compose logs -f agent-service agent-brain | grep -i campaign
```

### Дебаггинг конкретной проблемы

```bash
# 1. Найти ошибку
docker-compose logs | grep -i "specific error message"

# 2. Получить контекст (10 строк до и после)
docker-compose logs | grep -B10 -A10 "specific error message"

# 3. Найти requestId из ошибки
docker-compose logs | grep "specific error message" | grep -o 'requestId":"[^"]*'

# 4. Получить все логи для этого requestId
docker-compose logs | grep "requestId.*<extracted-id>"
```

### Анализ производительности

```bash
# Медленные запросы (если логируется duration)
docker-compose logs agent-service | grep duration | grep -E 'duration":[0-9]{4,}'

# Запросы к внешним API
docker-compose logs -f | grep -E 'fetch|axios|request' | grep -i duration

# Database queries
docker-compose logs agent-service agent-brain | grep -i "query\|sql"
```

---

## Troubleshooting (Поиск проблем)

### Проблемы с подключением

```bash
# Проверить все health endpoints
curl http://localhost:8082/health        # agent-service
curl http://localhost:7080/api/brain/llm-ping  # agent-brain
curl http://localhost:3100/ready         # Loki
curl http://localhost:3000/api/health    # Grafana
curl http://localhost:8080/manager/status # Evolution API

# Логи сетевых ошибок
docker-compose logs | grep -i "econnrefused\|enotfound\|timeout"

# Проверить DNS resolution
docker exec agents-monorepo-agent-service-1 nslookup loki
```

### Проблемы с памятью

```bash
# Статистика памяти контейнеров
docker stats --no-stream

# Мониторинг в реальном времени
docker stats

# Логи out-of-memory
docker-compose logs | grep -i "oom\|out of memory"

# Проверить swap
docker info | grep -i swap
```

### Проблемы с диском

```bash
# Размер логов Docker
du -sh /var/lib/docker/containers/*/

# Топ 5 самых больших логов
du -sh /var/lib/docker/containers/*/ | sort -rh | head -5

# Очистка старых логов (ОСТОРОЖНО!)
# docker-compose down
# truncate -s 0 /var/lib/docker/containers/*/*-json.log
# docker-compose up -d
```

### Проблемы с Loki

```bash
# Проверить, что Promtail отправляет логи в Loki
curl http://localhost:9080/metrics | grep promtail_sent_entries_total

# Проверить, что Loki принимает логи
curl http://localhost:3100/metrics | grep loki_distributor_lines_received_total

# Логи ошибок Loki
docker-compose logs loki | grep -i error

# Проверить конфигурацию Loki
curl http://localhost:3100/config | jq
```

### Проблемы с WhatsApp

```bash
# QR код не генерируется
docker-compose logs evolution-api | grep -i "qr\|instance"

# Проблемы с подключением
docker-compose logs evolution-api | grep -i "connection\|baileys"

# Сообщения не отправляются
docker-compose logs evolution-api | grep -i "sendMessage\|failed"

# Webhook не работает
docker-compose logs evolution-api | grep -i "webhook"

# Проверить статус инстанса
curl -H "apikey: YOUR_API_KEY" http://localhost:8080/instance/connectionState/INSTANCE_NAME
```

---

## Экспорт и сохранение логов

### Экспорт в файл

```bash
# Все логи за сегодня
docker-compose logs --since $(date +%Y-%m-%d) > logs-$(date +%Y%m%d).txt

# Последние 5000 строк
docker-compose logs --tail=5000 > logs-last-5000.txt

# Конкретный сервис
docker-compose logs --tail=2000 agent-service > agent-service-logs.txt

# Только ошибки
docker-compose logs | grep -i error > all-errors.txt

# JSON формат (для анализа)
docker-compose logs --tail=1000 agent-service | grep '^{' > agent-service.json
```

### Экспорт с временными метками

```bash
# За последние 24 часа
docker logs agents-monorepo-agent-service-1 --since 24h > agent-service-24h.log

# За конкретный период
docker logs agents-monorepo-agent-brain-1 \
  --since 2025-10-29T00:00:00 \
  --until 2025-10-29T23:59:59 > agent-brain-oct29.log
```

### Экспорт из Loki

```bash
# Через API (требует jq)
curl -G "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service="agent-service"}' \
  --data-urlencode 'start='$(date -u -d '1 hour ago' +%s)000000000 \
  --data-urlencode 'end='$(date -u +%s)000000000 \
  --data-urlencode 'limit=5000' | jq -r '.data.result[].values[][1]' > loki-export.log
```

### Ротация логов

```bash
# Создать backup текущих логов
timestamp=$(date +%Y%m%d_%H%M%S)
docker-compose logs > backup/logs_${timestamp}.txt

# Очистить логи Docker (ОСТОРОЖНО!)
# docker-compose down
# find /var/lib/docker/containers/ -name "*-json.log" -exec truncate -s 0 {} \;
# docker-compose up -d
```

---

## Дополнительная информация

### N8N (Workflow Automation)

**Примечание:** N8N использует отдельный docker-compose.yml в `/root/`

```bash
# Логи N8N
docker logs root-n8n-1

# Реал-тайм
docker logs -f root-n8n-1

# Последние 100 строк
docker logs --tail=100 root-n8n-1

# Health check
curl http://localhost:5678/healthz
```

### Прямой доступ к логам Docker

```bash
# Список всех контейнеров
docker ps

# Логи по ID контейнера
docker logs <container-id>

# Логи по имени
docker logs agents-monorepo-agent-service-1

# Follow mode
docker logs -f agents-monorepo-agent-service-1

# С timestamp
docker logs -t agents-monorepo-agent-service-1
```

### Копирование логов из контейнера

```bash
# Если логи хранятся в файле внутри контейнера
docker cp agents-monorepo-agent-service-1:/app/logs/app.log ./local-app.log

# Nginx access logs
docker cp agents-monorepo-nginx-1:/var/log/nginx/access.log ./nginx-access.log
docker cp agents-monorepo-nginx-1:/var/log/nginx/error.log ./nginx-error.log
```

---

## Алиасы для быстрого доступа (опционально)

Добавьте в `~/.bashrc` или `~/.zshrc`:

```bash
# Docker Compose логи
alias dclogs='docker-compose logs'
alias dclogsf='docker-compose logs -f'
alias dclogs-agent='docker-compose logs -f agent-service'
alias dclogs-brain='docker-compose logs -f agent-brain'
alias dclogs-evolution='docker-compose logs -f evolution-api'
alias dclogs-nginx='docker-compose logs -f nginx'
alias dclogs-errors='docker-compose logs | grep -i error'

# Docker логи
alias dlogs='docker logs'
alias dlogsf='docker logs -f'

# Health checks
alias health-all='curl http://localhost:8082/health && curl http://localhost:7080/api/brain/llm-ping && curl http://localhost:3100/ready && curl http://localhost:3000/api/health'

# Loki query
alias loki-errors='curl -G "http://localhost:3100/loki/api/v1/query" --data-urlencode "query={level=\"error\"}" --data-urlencode "limit=20"'

# Stats
alias dstats='docker stats --no-stream'
```

После добавления выполните:

```bash
source ~/.bashrc  # или source ~/.zshrc
```

---

## Связанные документы

- **INFRASTRUCTURE.md** - Полная документация инфраструктуры
- **LOGGING_GUIDE.md** - Руководство по логированию и мониторингу
- **DEPLOY_GUIDE.md** - Руководство по деплою
- **README.md** - Обзор проекта и quick start

---

## Контакты и поддержка

При возникновении проблем с логированием:

1. Проверьте статус контейнеров: `docker-compose ps`
2. Проверьте health endpoints (см. секцию "Быстрый доступ")
3. Проверьте Grafana дашборды: http://localhost:3000
4. Проверьте Loki API: http://localhost:3100/ready

**Telegram Alerts:** Если настроено, ошибки автоматически отправляются в Telegram (см. `agent-brain/src/lib/logAlerts.js`)

---

**Последнее обновление:** 2025-10-29
**Версия:** 1.0
