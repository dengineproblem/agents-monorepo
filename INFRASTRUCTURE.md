# 🏗️ ИНФРАСТРУКТУРА ПРОЕКТА - ПОЛНАЯ ДОКУМЕНТАЦИЯ

> **ВАЖНО:** Этот документ содержит актуальную информацию по всей инфраструктуре проекта. Читать перед любым деплоем!

---

## 📋 ОГЛАВЛЕНИЕ

1. [Архитектура системы](#архитектура-системы)
2. [Домены и их назначение](#домены-и-их-назначение)
3. [Docker контейнеры и порты](#docker-контейнеры-и-порты)
4. [Nginx конфигурация](#nginx-конфигурация)
5. [Две версии Frontend](#две-версии-frontend)
6. [Процесс деплоя](#процесс-деплоя)
7. [Troubleshooting](#troubleshooting)

---

## 🏛️ АРХИТЕКТУРА СИСТЕМЫ

### **Общая схема:**

```
Интернет (HTTPS :443 / HTTP :80)
    ↓
Docker nginx (контейнер)
    ├─ performanteaiagency.com → frontend-appreview:80 (App Review версия)
    ├─ app.performanteaiagency.com → frontend:80 (Production версия)
    └─ */api/* → agent-service:8082 (Backend API)
         └─ /api/analyzer/* → creative-analyzer:7081
```

### **Важные моменты:**

- ✅ **НЕТ системного nginx** (он остановлен и отключен)
- ✅ Docker nginx **напрямую** слушает порты 80/443
- ✅ SSL сертификаты монтируются из `/etc/letsencrypt` в Docker nginx
- ✅ Все сервисы изолированы в Docker сети

---

## 📊 UNIFIED METRICS SYSTEM (Система унифицированных метрик)

**Статус:** ✅ Активна (с 20 ноября 2025)  
**Документация:** [METRICS_SYSTEM.md](./METRICS_SYSTEM.md)

### **Проблема и решение:**

**До:**
- ❌ Каждый сервис (auto-launch, scoring, creative tests) делал запросы к Facebook API
- ❌ Дублирование данных и логики
- ❌ Медленная работа (5-10 секунд на 20 креативов)
- ❌ Риск упереться в rate limits Facebook API

**После:**
- ✅ agent-brain собирает метрики утром **один раз** (cron 9:00)
- ✅ Все сервисы читают из единой таблицы `creative_metrics_history` (быстро, < 1 сек)
- ✅ Fallback на Facebook API только для новых креативов
- ✅ Снижена нагрузка на Facebook API в ~20 раз

### **Архитектура потока данных:**

```
Facebook API (источник данных)
    ↓
agent-brain (cron 9:00 UTC+6) → creative_metrics_history (БД)
    ↓                                    ↓
    ├────────────────────┬───────────────┴─────────────┐
    ↓                    ↓                             ↓
auto-launch         scoring agent              creative tests
(читает из БД)      (читает из БД)            (читает из БД)
```

### **Ключевые компоненты:**

1. **Таблица `creative_metrics_history`:**
   - Хранит метрики на уровне **Ad** (не AdSet)
   - Поля: `ad_id`, `creative_id`, `impressions`, `clicks`, `leads`, `cpl`, etc.
   - Уникальность: 1 запись = 1 Ad + 1 день

2. **agent-brain (сборщик метрик):**
   - Файл: `services/agent-brain/src/scoring.js`
   - Функция: `saveCreativeMetricsToHistory()`
   - Запускается: Утром по cron (9:00)

3. **auto-launch (потребитель метрик):**
   - Файл: `services/agent-service/src/lib/campaignBuilder.ts`
   - Функция: `getCreativeMetrics()`
   - Логика: Сначала БД → fallback на FB API

4. **creative test analyzer:**
   - Файл: `services/agent-brain/src/analyzerService.js`
   - Также сохраняет метрики тестов в `creative_metrics_history`

### **Мониторинг:**

Проверить статус системы:
```sql
-- Проверить последнее обновление
SELECT 
  user_account_id,
  MAX(date) as last_update,
  COUNT(DISTINCT ad_id) as total_ads
FROM creative_metrics_history
GROUP BY user_account_id;
```

Проверить эффективность (логи auto-launch):
```bash
docker logs agents-monorepo-agent-service-1 | grep "fromDB"
# Ожидаем: fromDB=20 fromAPI=0 (все из БД, нет запросов к FB API)
```

### **Важные миграции:**

- `030_expand_creative_metrics_history.sql` - Добавляет `ad_id`, `clicks`, `leads`, `cpl`

---

## 🔍 COMPETITOR TRACKING SYSTEM (Анализ конкурентов)

**Статус:** ✅ Активна (с 1 декабря 2025)

### **Возможности:**

- ✅ Добавление конкурентов по Facebook/Instagram URL
- ✅ Автосбор креативов из Meta Ads Library
- ✅ Система скоринга креативов (0-100 баллов)
- ✅ ТОП-10 лучших креативов с бейджем "Новый"
- ✅ OCR для изображений (Gemini 2.0 Flash)
- ✅ Транскрипция видео (OpenAI Whisper)
- ✅ Еженедельное обновление креативов (cron)

### **Архитектура:**

```
Meta Ads Library API
    ↓
agent-service (API + cron)
    ├─ POST /competitors - добавить конкурента
    ├─ POST /competitors/:id/refresh - обновить креативы
    ├─ GET /competitors/:id/creatives - получить ТОП-10
    └─ POST /competitors/extract-text - OCR/транскрипция
         ↓
    ┌────┴────┐
    ↓         ↓
Gemini OCR  Whisper (транскрипция)
(images)    (videos)
```

### **Система скоринга:**

Каждый креатив получает score 0-100:
- **Активность:** +40 баллов если реклама активна
- **Длительность:** +30 баллов за 30+ дней показа (линейно)
- **Платформы:** +15 баллов если на FB и IG
- **Видео:** +10 баллов за видео-формат
- **Вариации:** +5 баллов если > 3 вариантов объявления

ТОП-10 с наивысшим score сохраняются и показываются.

### **Таблицы БД:**

1. **`competitors`** - реестр конкурентов
   - `fb_page_id`, `name`, `status`, `next_crawl_at`

2. **`user_competitors`** - связь пользователя с конкурентами (many-to-many)
   - `user_account_id`, `competitor_id`

3. **`competitor_creatives`** - креативы конкурентов
   - `fb_ad_archive_id`, `media_type`, `score`, `is_top10`, `entered_top10_at`

4. **`competitor_creative_analysis`** - OCR/транскрипции
   - `creative_id`, `transcript`, `ocr_text`, `processing_status`

### **Миграции:**

- `054_create_competitors_tables.sql` - Базовые таблицы
- `055_add_competitor_scoring.sql` - Поля скоринга и ТОП-10

### **Cron (еженедельный сбор):**

Файл: `services/agent-service/src/cron/competitorCrawler.ts`

- Запуск: раз в неделю (по `next_crawl_at`)
- Проверка: каждый час
- Сбор: до 50 креативов на конкурента
- Скоринг: автоматический пересчёт при каждом сборе

---

## 🌐 ДОМЕНЫ И ИХ НАЗНАЧЕНИЕ

### **1. `performanteaiagency.com` (App Review версия)**

**Назначение:** Упрощенная версия для прохождения Facebook App Review

**Особенности:**
- ✅ Полностью на **английском языке**
- ❌ **БЕЗ** переключателя языков
- ❌ **БЕЗ** разделов: Creatives, Directions, AI Autopilot, ROI Analytics
- ✅ В Actions только **2 кнопки**: "Upload Video" и "Upload Image"
- ✅ Диалоги подтверждения для всех критических действий

**Docker контейнер:** `agents-monorepo-frontend-appreview-1`  
**Порт внутри сети:** `frontend-appreview:80`  
**Порт на хосте:** `3002` (для отладки)

---

### **2. `app.performanteaiagency.com` (Production версия)**

**Назначение:** Полная рабочая версия для реальных пользователей

**Особенности:**
- ✅ Переключатель языков (RU/EN)
- ✅ Все разделы: Dashboard, Campaigns, Creatives, Directions, AI Autopilot, ROI Analytics
- ✅ Все кнопки в Actions: Autostart, Manual Launch, Add to Sale, Upload Video, Upload Image

**Docker контейнер:** `agents-monorepo-frontend-1`  
**Порт внутри сети:** `frontend:80`  
**Порт на хосте:** `3001` (для отладки)

---

### **3. `n8n.performanteaiagency.com` (Workflow Automation)**

**Назначение:** Автоматизация workflows, генерация креативов с текстом, интеграции

**Особенности:**
- ✅ Python 3.12.12 + Pillow 11.0.0 для генерации изображений
- ✅ ffmpeg для обработки видео
- ✅ WebSocket для real-time обновлений workflow
- ✅ Шрифты DejaVu для текста на изображениях
- ✅ PostgreSQL для хранения данных

**Docker контейнеры:** 
- `root-n8n-1` - основной контейнер n8n
- `root-postgres-1` - база данных PostgreSQL

**Важные детали:**
- **Docker-compose:** `/root/docker-compose.yml` (отдельный от основного)
- **Dockerfile:** `/root/Dockerfile`
- **Сеть:** `root_default` + подключен к `agents-monorepo_default` (для связи с nginx)
- **Volume:** `n8n_data` - хранит все workflows и настройки
- **Порт внутри:** `5678`
- **Домен:** `https://n8n.performanteaiagency.com`

---

### **4. `agent.performanteaiagency.com` (TikTok API Proxy)**

**Назначение:** Прокси для запросов к TikTok Marketing API

**Особенности:**
- ✅ Проксирует запросы фронтенда к TikTok API через legacy сервис на хосте
- ✅ Endpoint: `/tproxy` (GET и POST)
- ✅ CORS headers для кросс-доменных запросов
- ✅ Используется в `tiktokApi.ts` для получения кампаний и статистики

**Backend сервис:** Legacy Node.js процесс `/opt/tiktok-proxy/index.js` (порт 4001 на хосте)  
**Проксирование:** Docker nginx → `http://172.17.0.1:4001/api/tiktok`

**Подробности:** См. `TIKTOK_OAUTH_INTEGRATION.md` → раздел "TikTok API Proxy Service"

---

### **5. Другие домены (для справки)**

- `agents.performanteaiagency.com` - прямой доступ к agent-service API (не используется в продакшене)
- `agent2.performanteaiagency.com` - legacy (не используется)
- `brain2.performanteaiagency.com` - legacy (не используется)

---

## 🐳 DOCKER КОНТЕЙНЕРЫ И ПОРТЫ

### **Таблица портов:**

| Контейнер | Внутренний порт | Внешний порт (хост) | Назначение |
|-----------|-----------------|---------------------|------------|
| `nginx` | 80, 443 | **80, 443** | Главный веб-сервер, SSL терминация |
| `frontend` (production) | 80 | 3001 | Production версия React приложения |
| `frontend-appreview` | 80 | 3002 | App Review версия React приложения |
| `agent-service` | 8082 | 8082 | Backend API (Facebook, workflows) |
| `creative-analyzer` | 7081 | 7081 | LLM анализатор креативов |
| `agent-brain` | 7080 | 7080 | Scoring agent (cron jobs) |
| `loki` | 3100 | 3100 | Логирование (Grafana Loki) |
| `grafana` | 3000 | 3000 | Мониторинг и визуализация логов |
| `n8n` | 5678 | 5678 | Workflow automation (отдельный docker-compose) |
| `postgres` | 5432 | - | БД для n8n (не публичный) |
| `evolution-api` | 8080 | 8080 | WhatsApp Business API (Evolution API) |
| `evolution-postgres` | 5432 | 5433 | БД для Evolution API |
| `evolution-redis` | 6379 | 6380 | Cache для Evolution API |
| `tiktok-proxy` (на хосте) | 4001 | 4001 | TikTok Marketing API proxy (legacy, не в Docker) |
| `SSH tunnel` (локальная разработка) | 5434 | 5434 | Туннель к production evolution-postgres для CRM |
| `crm-backend` | 8084 | 8084 | Backend анализа WhatsApp диалогов |
| `crm-frontend` | 80 | 3003 | Frontend CRM (nginx в контейнере) |
| `chatbot-service` | 8083 | 8083 | Чатбот автоматизация |
| `chatbot-worker` | - | - | Worker для reactivation campaigns |
| `redis-chatbot` | 6379 | 6381 | Cache для chatbot |

**Локальная разработка (без Docker):**
- crm-backend: 8084 (то же)
- crm-frontend: 5174 (Vite dev server)
- chatbot-service: 8083 (то же)

### **Docker Compose файлы:**

- **Основной:** `/root/agents-monorepo/docker-compose.yml` (все сервисы агентов, фронтенды, nginx)
  - Сеть: `agents-monorepo_default`
  - Контейнеры: nginx, frontend, frontend-appreview, agent-service, agent-brain, creative-analyzer, loki, promtail, grafana, evolution-api, evolution-postgres, evolution-redis, crm-backend, crm-frontend, chatbot-service, chatbot-worker, redis-chatbot
  
- **N8N (отдельный):** `/root/docker-compose.yml` (n8n + postgres)
  - Сеть: `root_default`
  - Контейнеры: n8n, postgres
  - **ВАЖНО:** n8n также подключен к `agents-monorepo_default` через `docker network connect` для связи с nginx

---

## 📱 WHATSAPP CRM & CHATBOT

### **Архитектура системы**

WhatsApp CRM - это отдельная подсистема для управления лидами из WhatsApp с AI-анализом диалогов.

**Компоненты:**

1. **crm-backend** (Fastify + TypeScript)
   - Анализ WhatsApp диалогов с помощью OpenAI GPT-5-mini
   - Квалификация лидов (hot/warm/cold)
   - Скоринг (0-100) и определение этапа воронки
   - REST API для фронтенда
   - **Порт:** 8084
   - **Источник данных:** Evolution PostgreSQL (сообщения WhatsApp)
   - **Хранилище:** Supabase (результаты анализа в таблице `dialog_analysis`)

2. **crm-frontend** (React + Vite + shadcn/ui)
   - Kanban CRM с Drag & Drop (7 этапов воронки)
   - Управление лидами, фильтрация, экспорт в CSV
   - Настройки чатбота (промпт, документы, триггеры)
   - Реактивация campaigns
   - **Порт (dev):** 5174 (Vite dev server)
   - **Порт (production):** 3003 (nginx в контейнере)

3. **chatbot-service** (Node.js + Supabase)
   - Автоматизация диалогов WhatsApp
   - Триггеры и реактивация холодных лидов
   - Управление конфигурацией бота
   - **Порт:** 8083

4. **chatbot-worker**
   - Background worker для cron jobs
   - Reactivation campaigns (массовая рассылка)
   - **Порт:** нет (внутренний процесс)

5. **redis-chatbot**
   - Cache для chatbot
   - **Порт:** 6381 (внешний), 6379 (внутри)

**Зависимости:**
- **Evolution API** (8080) - источник WhatsApp сообщений
- **Supabase** - хранилище результатов анализа
- **OpenAI** - AI анализ диалогов

### **API Endpoints**

#### **CRM Backend** (`/api/crm/*`)

Все запросы проксируются через nginx:
- Клиент: `https://app.performanteaiagency.com/api/crm/dialogs/stats`
- Nginx rewrite: убирает `/api/crm`
- Backend получает: `/dialogs/stats`

**Endpoints:**
- `POST /dialogs/analyze` - запустить AI анализ диалогов для instance
  - Body: `{ instanceName, userAccountId, minIncoming, maxDialogs, maxContacts }`
  - Response: статистика анализа (total, hot, warm, cold)

- `GET /dialogs/analysis` - получить проанализированные лиды с фильтрами
  - Query: `userAccountId`, `instanceName`, `interestLevel`, `minScore`, `funnelStage`
  - Response: массив лидов

- `GET /dialogs/stats` - статистика по лидам (hot/warm/cold/total)
  - Query: `userAccountId`
  - Response: `{ hot: 10, warm: 20, cold: 15, total: 45 }`

- `POST /dialogs/leads` - создать лид вручную
  - Body: `{ userAccountId, phoneNumber, contactName, funnelStage, ... }`

- `PATCH /dialogs/leads/:id` - обновить лид (этап воронки, статус бота)
  - Body: `{ funnelStage, botStatus, score, ... }`

- `DELETE /dialogs/analysis/:id` - удалить лид

- `GET /dialogs/export-csv` - экспорт лидов в CSV
  - Query: `userAccountId` + фильтры
  - Response: CSV файл

#### **Chatbot Service** (`/api/chatbot/*`)

**Endpoints:**
- `GET /stats` - статистика бота (активные диалоги, сообщений/день)
- `GET /configuration/:userId` - получить конфигурацию бота
- `PUT /configuration/:configId` - обновить конфигурацию
- `POST /documents/upload` - загрузить документ для RAG
- `DELETE /documents/:fileId` - удалить документ
- `POST /regenerate-prompt` - регенерировать промпт из документов
- `GET /triggers` - список триггеров
- `POST /triggers` - создать триггер
- `PUT /triggers/:id` - обновить триггер
- `DELETE /triggers/:id` - удалить триггер
- `GET /reactivation/queue` - очередь рассылки (top 300 cold leads)
- `POST /reactivation/start` - запустить reactivation campaign
- `DELETE /reactivation/cancel` - отменить reactivation campaign

### **Nginx маршрутизация**

**Production** (`app.performanteaiagency.com` и `performanteaiagency.com`):

```nginx
# CRM Frontend (статика)
location /crm/ {
    proxy_pass http://crm-frontend:80/;
}

# CRM Backend API
location /api/crm/ {
    rewrite ^/api/crm/(.*)$ /$1 break;
    proxy_pass http://crm-backend:8084;
}

# Chatbot Service API
location /api/chatbot/ {
    rewrite ^/api/chatbot/(.*)$ /$1 break;
    proxy_pass http://chatbot-service:8083;
}
```

**Локальная разработка** (Vite proxy в `vite.config.ts`):

```typescript
proxy: {
  '/api/crm': {
    target: 'http://localhost:8084',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/crm/, ''),
  },
  '/api/chatbot': {
    target: 'http://localhost:8083',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/chatbot/, ''),
  },
}
```

### **Система скоринга лидов**

**Базовый score по этапу воронки:**
- `new_lead`: 5
- `not_qualified`: 15
- `qualified`: 30
- `consultation_booked`: 40
- `consultation_completed`: 55
- `deal_closed`: 75
- `deal_lost`: 0

**Модификаторы:**
- Медицина: +15
- Инфобизнес: +10
- Владелец бизнеса: +10
- Бюджет указан: +10
- Таргетолог/SMM: -30

**Interest Level:**
- **HOT (75-100)**: Записан на консультацию или готов записаться
- **WARM (40-74)**: Есть интерес, но не готов к действию
- **COLD (0-39)**: Слабый интерес или нецелевая ниша

---

## ⚙️ NGINX КОНФИГУРАЦИЯ

### **Файл:** `nginx-production.conf` (в репозитории)

**Монтирование:**
```yaml
nginx:
  volumes:
    - ./nginx-production.conf:/etc/nginx/nginx.conf:ro
    - /etc/letsencrypt:/etc/letsencrypt:ro
```

### **Ключевые блоки:**

#### **1. App Review Frontend (`performanteaiagency.com`):**
```nginx
location / {
    proxy_pass http://frontend-appreview:80;
}

location /evolution/ {
    proxy_pass http://evolution-api:8080/;
}

location /api/ {
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://agent-service:8082;
}

location /api/analyzer/ {
    rewrite ^/api/analyzer/(.*)$ /$1 break;
    proxy_pass http://creative-analyzer:7081;
}
```

#### **2. Production Frontend (`app.performanteaiagency.com`):**
```nginx
location / {
    proxy_pass http://frontend:80;
}

location /evolution/ {
    proxy_pass http://evolution-api:8080/;
}

location /api/ {
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://agent-service:8082;
}

location /api/analyzer/ {
    rewrite ^/api/analyzer/(.*)$ /$1 break;
    proxy_pass http://creative-analyzer:7081;
}
```

#### **3. N8N Workflow Automation (`n8n.performanteaiagency.com`):**
```nginx
# WebSocket поддержка (в начале http блока)
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl http2;
    server_name n8n.performanteaiagency.com;
    
    # Webhooks с CORS
    location ^~ /webhook/ {
        client_max_body_size 512M;
        proxy_pass http://root-n8n-1:5678;
        proxy_http_version 1.1;
        
        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        
        # Таймауты для долгих операций
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
    
    # Интерфейс n8n
    location / {
        proxy_pass http://root-n8n-1:5678;
        proxy_http_version 1.1;
        
        # WebSocket support (КРИТИЧНО для работы workflow!)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**ВАЖНО:** 
- `map $http_upgrade $connection_upgrade` должен быть ПЕРЕД server блоками
- Использовать `Connection $connection_upgrade`, НЕ `Connection "upgrade"`
- Без правильного WebSocket workflow не будут открываться!

### **SSL сертификаты:**
- `performanteaiagency.com`: `/etc/letsencrypt/live/performanteaiagency.com/`
- `app.performanteaiagency.com`: `/etc/letsencrypt/live/app.performanteaiagency.com/`
- `n8n.performanteaiagency.com`: `/etc/letsencrypt/live/n8n.performanteaiagency.com/`

---

## 🎨 ДВЕ ВЕРСИИ FRONTEND

### **Как это работает:**

**Dockerfile:** `services/frontend/Dockerfile`

```dockerfile
ARG BUILD_MODE=production

RUN if [ "$BUILD_MODE" = "appreview" ]; then \
      echo "VITE_APP_REVIEW_MODE=true" > .env.local && \
      echo "VITE_API_BASE_URL=https://performanteaiagency.com/api" >> .env.local && \
      echo "VITE_FB_APP_ID=1441781603583445" >> .env.local && \
      echo "VITE_FB_REDIRECT_URI=https://performanteaiagency.com/profile" >> .env.local; \
    else \
      echo "VITE_APP_REVIEW_MODE=false" > .env.local && \
      echo "VITE_API_BASE_URL=https://app.performanteaiagency.com/api" >> .env.local && \
      echo "VITE_FB_APP_ID=1441781603583445" >> .env.local && \
      echo "VITE_FB_REDIRECT_URI=https://app.performanteaiagency.com/profile" >> .env.local; \
    fi
```

**Docker Compose:**
```yaml
frontend:
  build:
    context: ./services/frontend
    args:
      BUILD_MODE: production

frontend-appreview:
  build:
    context: ./services/frontend
    args:
      BUILD_MODE: appreview
```

### **Переменные окружения:**

| Переменная | Production | App Review |
|------------|-----------|------------|
| `VITE_APP_REVIEW_MODE` | `false` | `true` |
| `VITE_API_BASE_URL` | `https://app.performanteaiagency.com/api` | `https://performanteaiagency.com/api` |
| `VITE_FB_REDIRECT_URI` | `https://app.performanteaiagency.com/profile` | `https://performanteaiagency.com/profile` |

### **Логика в коде:**

`services/frontend/src/config/appReview.ts`:
```typescript
export const APP_REVIEW_MODE = import.meta.env.VITE_APP_REVIEW_MODE === 'true';

export const FEATURES = {
  SHOW_TIKTOK: !APP_REVIEW_MODE,
  SHOW_CREATIVES: !APP_REVIEW_MODE,
  SHOW_DIRECTIONS: !APP_REVIEW_MODE,
  SHOW_AI_AUTOPILOT: !APP_REVIEW_MODE,
  SHOW_ROI_ANALYTICS: !APP_REVIEW_MODE,
  SHOW_LANGUAGE_SWITCHER: !APP_REVIEW_MODE,
};
```

---

## 🚀 ПРОЦЕСС ДЕПЛОЯ

### **📝 ПОШАГОВАЯ ИНСТРУКЦИЯ**

#### **1. Коммит и пуш изменений (локально):**
```bash
cd ~/agents-monorepo
git add .
git commit -m "Your commit message"
git push origin main
```

#### **2. На сервере - подтянуть изменения:**
```bash
ssh root@your-server

cd ~/agents-monorepo
git pull origin main
```

#### **3. Пересобрать и перезапустить контейнеры:**

**ВАРИАНТ A: Пересобрать ВСЕ контейнеры (если меняли код):**
```bash
docker-compose build
docker-compose down
docker-compose up -d
```

**ВАРИАНТ B: Пересобрать ТОЛЬКО фронтенд:**
```bash
# Production версия
docker-compose build frontend
docker-compose up -d frontend

# App Review версия
docker-compose build frontend-appreview
docker-compose up -d frontend-appreview
```

**ВАРИАНТ C: Пересобрать ТОЛЬКО backend:**
```bash
docker-compose build agent-service
docker-compose up -d agent-service
```

**ВАРИАНТ D: Пересобрать ТОЛЬКО agent-brain:**
```bash
docker-compose build agent-brain creative-analyzer
docker-compose up -d agent-brain creative-analyzer
```

**ВАРИАНТ E: Пересобрать N8N (отдельный docker-compose):**
```bash
cd /root
docker-compose build n8n
docker-compose down
docker-compose up -d

# Проверить что n8n подключен к сети nginx
docker network connect agents-monorepo_default root-n8n-1 2>/dev/null || echo "Already connected"

# Перезагрузить nginx для применения конфигурации
cd /root/agents-monorepo
docker-compose restart nginx
```

**ВАРИАНТ F: Обновить Evolution API (сборка из исходников):**
```bash
# 1. Перейти в репозиторий Evolution API
cd ~/evolution-api

# 2. Подтянуть обновления
git fetch --all --tags

# 3. Посмотреть доступные версии
git tag | grep "2\." | tail -10

# 4. Переключиться на нужную версию (например 2.3.7)
git checkout 2.3.7
git submodule update --init --recursive

# 5. Собрать новый образ
docker build -t atendai/evolution-api:2.3.7 .

# 6. Обновить docker-compose.yml (указать новую версию)
cd ~/agents-monorepo
# Вручную отредактировать: image: atendai/evolution-api:2.3.7

# 7. Перезапустить контейнер
docker-compose down evolution-api
docker-compose up -d evolution-api

# 8. Проверить версию
curl -s https://evolution.performanteaiagency.com/ | grep version
```

**ВАЖНО для Evolution API:**
- Docker Hub образы могут отставать от GitHub releases
- Рекомендуется собирать из исходников для получения последних фиксов
- БД и Redis данные сохраняются в volumes при обновлении
- Инстансы WhatsApp остаются подключенными после обновления

#### **4. Проверить статус контейнеров:**
```bash
docker ps
```

Все контейнеры должны быть в статусе `Up`:
- `agents-monorepo-nginx-1`
- `agents-monorepo-frontend-1`
- `agents-monorepo-frontend-appreview-1`
- `agents-monorepo-agent-service-1`
- `agents-monorepo-agent-brain-1`
- `agents-monorepo-creative-analyzer-1`

#### **5. Проверить логи (если что-то не работает):**
```bash
# Все контейнеры
docker-compose logs -f

# Конкретный контейнер
docker-compose logs -f frontend
docker-compose logs -f nginx
docker-compose logs -f agent-service
```

#### **6. Проверить сайты в браузере:**
- `https://performanteaiagency.com` (App Review)
- `https://app.performanteaiagency.com` (Production)

---

## 🛠️ TROUBLESHOOTING

### **❌ ПРОБЛЕМА: "Port 80/443 already in use"**

**Причина:** Системный nginx занял порты 80/443

**Решение:**
```bash
# 1. Остановить системный nginx
sudo systemctl stop nginx
sudo systemctl disable nginx

# 2. Удалить "застрявший" Docker nginx
docker rm -f agents-monorepo-nginx-1

# 3. Перезапустить Docker nginx
docker-compose up -d nginx

# 4. Проверить
docker ps | grep nginx
```

---

### **❌ ПРОБЛЕМА: Изменения в коде не применяются**

**Причина:** Docker использует старый image

**Решение:**
```bash
# 1. Пересобрать БЕЗ КЭША
docker-compose build --no-cache frontend frontend-appreview

# 2. Перезапустить
docker-compose up -d frontend frontend-appreview

# 3. Проверить что image пересобрался
docker images | grep frontend
```

---

### **❌ ПРОБЛЕМА: Nginx показывает "502 Bad Gateway"**

**Причина:** Backend контейнер не запущен или упал

**Решение:**
```bash
# 1. Проверить статус
docker ps -a | grep agent-service

# 2. Посмотреть логи
docker-compose logs agent-service

# 3. Перезапустить
docker-compose restart agent-service
```

---

### **❌ ПРОБЛЕМА: "CORS error" в браузере**

**Причина:** Неправильный `VITE_API_BASE_URL` в frontend

**Решение:**
```bash
# 1. Проверить переменные внутри контейнера
docker exec agents-monorepo-frontend-1 cat /usr/share/nginx/html/index.html | grep VITE

# 2. Если неправильные - пересобрать
docker-compose build --no-cache frontend frontend-appreview
docker-compose up -d frontend frontend-appreview
```

---

### **❌ ПРОБЛЕМА: Обе версии фронтенда одинаковые**

**Причина:** Docker не пересобрал с разными `BUILD_MODE`

**Решение:**
```bash
# 1. Удалить старые images
docker rmi $(docker images -q agents-monorepo-frontend)
docker rmi $(docker images -q agents-monorepo-frontend-appreview)

# 2. Пересобрать с нуля
docker-compose build --no-cache frontend frontend-appreview

# 3. Перезапустить
docker-compose up -d frontend frontend-appreview
```

---

### **❌ ПРОБЛЕМА: SSL сертификат истёк**

**Причина:** Let's Encrypt сертификаты действительны 90 дней

**Решение:**
```bash
# 1. Обновить сертификаты
sudo certbot renew

# 2. Перезапустить nginx
docker-compose restart nginx

# 3. Проверить дату истечения
sudo certbot certificates
```

---

### **❌ ПРОБЛЕМА: n8n открывается, но workflow не открываются (зависают)**

**Причина:** WebSocket не работает - неправильная конфигурация nginx

**Решение:**
```bash
# 1. Проверить что в nginx-production.conf есть map директива
grep "map.*http_upgrade" /root/agents-monorepo/nginx-production.conf

# Если НЕТ - добавить в начало http блока (после error_log):
# map $http_upgrade $connection_upgrade {
#     default upgrade;
#     '' close;
# }

# 2. Проверить что используется $connection_upgrade, а не "upgrade"
grep "Connection.*connection_upgrade" /root/agents-monorepo/nginx-production.conf

# Если НЕТ - заменить Connection "upgrade" на Connection $connection_upgrade

# 3. Перезагрузить nginx
cd /root/agents-monorepo
docker-compose restart nginx

# 4. Проверить в браузере DevTools Console - не должно быть ошибок WebSocket
```

---

### **❌ ПРОБЛЕМА: n8n показывает 502 Bad Gateway**

**Причина:** n8n контейнер не подключен к сети nginx

**Решение:**
```bash
# 1. Проверить статус контейнера n8n
docker ps | grep n8n

# 2. Проверить сети n8n
docker inspect root-n8n-1 | grep -A 5 "Networks"

# 3. Подключить к сети nginx (если нужно)
docker network connect agents-monorepo_default root-n8n-1

# 4. Перезагрузить nginx
cd /root/agents-monorepo
docker-compose restart nginx

# 5. Проверить доступность
curl -I http://localhost:5678
```

---

### **❌ ПРОБЛЕМА: После пересоздания n8n контейнера пропал Python/Pillow**

**Причина:** Изменения не сохранены в Docker образе

**Решение:**
```bash
# 1. Проверить Dockerfile
cat /root/Dockerfile

# Должен содержать:
# RUN apk add --no-cache python3 py3-pillow jpeg-dev zlib-dev freetype-dev ...

# 2. Пересобрать образ
cd /root
docker-compose build --no-cache n8n

# 3. Пересоздать контейнер
docker-compose down
docker-compose up -d

# 4. Подключить к сети nginx
docker network connect agents-monorepo_default root-n8n-1 2>/dev/null

# 5. Проверить что Python и Pillow работают
docker exec root-n8n-1 python3 --version
docker exec root-n8n-1 python3 -c "from PIL import Image; print('OK')"
```

---

### **❌ ПРОБЛЕМА: crm-backend не может подключиться к production БД**

**Причина:** SSH туннель не работает или неправильно настроен

**Решение:**

```bash
# 1. Проверить что SSH туннель работает
lsof -i:5434
# Должен быть ssh процесс

# Если нет - запустить туннель
ssh -L 5434:localhost:5433 root@147.182.186.15 -N -f

# 2. Проверить SSH доступ к серверу
ssh root@147.182.186.15 echo "OK"
# Должно вернуть "OK" без запроса пароля

# 3. Проверить .env.crm
cat .env.crm | grep EVOLUTION_DB
# Должно быть:
# EVOLUTION_DB_HOST=host.docker.internal
# EVOLUTION_DB_PORT=5434

# 4. Проверить docker-compose.yml
cat docker-compose.yml | grep -A 5 "crm-backend:"
# Должен быть extra_hosts:
#   - "host.docker.internal:host-gateway"

# 5. Перезапустить crm-backend
docker-compose restart crm-backend

# 6. Проверить логи
docker logs agents-monorepo-crm-backend-1 --tail 20
# Должно быть: "Connected to Evolution PostgreSQL" с host: host.docker.internal

# 7. Если туннель падает - использовать autossh для автоперезапуска
brew install autossh  # macOS
autossh -M 0 -L 5434:localhost:5433 root@147.182.186.15 -N -f
```

**Альтернатива:** Использовать автоматический скрипт
```bash
./scripts/start-crm-dev.sh
# Скрипт сам настроит всё правильно
```

**Подробнее:** См. `services/crm-backend/DEV_SETUP.md`

---

### **📊 ПОЛЕЗНЫЕ КОМАНДЫ ДЛЯ ДИАГНОСТИКИ**

```bash
# Проверить все порты
sudo lsof -i :80
sudo lsof -i :443
sudo lsof -i :3001
sudo lsof -i :3002
sudo lsof -i :8082

# Проверить Docker сеть
docker network ls
docker network inspect agents-monorepo_default

# Проверить размер логов (если диск заполнен)
du -sh /var/lib/docker/containers/*/*-json.log

# Очистить старые Docker images
docker image prune -a

# Полная очистка (ОСТОРОЖНО!)
docker system prune -a --volumes
```

---

## 📂 СТРУКТУРА ПРОЕКТА

```
/root/agents-monorepo/
├── docker-compose.yml          # Основной файл для всех сервисов
├── nginx-production.conf       # Конфигурация nginx (монтируется в контейнер)
│                               # ВАЖНО: содержит map $http_upgrade для WebSocket
├── services/
│   ├── frontend/               # React приложение (Vite)
│   │   ├── Dockerfile          # Multi-stage build с BUILD_MODE
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   └── appReview.ts  # Feature flags для App Review
│   │   │   └── i18n/           # Переводы (EN/RU)
│   │   └── nginx.conf          # Nginx для статики внутри контейнера
│   ├── agent-service/          # Backend API (Fastify + TypeScript)
│   │   └── src/
│   │       ├── routes/         # API endpoints
│   │       └── workflows/      # Facebook API workflows
│   └── agent-brain/            # Scoring agent + Analyzer
│       └── src/
│           ├── scoring.js      # Основной scoring agent
│           └── analyzerService.js  # LLM анализатор
└── .env.brain, .env.agent      # Переменные окружения (не в git!)

/root/                          # N8N (отдельная директория)
├── docker-compose.yml          # N8N + Postgres
│                               # Образ: custom-n8n:latest-ffmpeg
│                               # Сеть: root_default + agents-monorepo_default
│                               # Volume: n8n_data (хранит workflow)
├── Dockerfile                  # Кастомный образ n8n с:
│                               # - Python 3.12.12
│                               # - Pillow 11.0.0
│                               # - ffmpeg
│                               # - Шрифты DejaVu
└── Dockerfile.backup           # Резервная копия
```

---

## 🔐 ВАЖНЫЕ ФАЙЛЫ (НЕ В GIT!)

**На сервере:**
- `/root/agents-monorepo/.env.brain` - переменные для agent-brain (OpenAI ключи, Supabase)
- `/root/agents-monorepo/.env.agent` - переменные для agent-service (Supabase)
- `/etc/letsencrypt/` - SSL сертификаты

**НИКОГДА НЕ КОММИТИТЬ:**
- `.env.*` файлы
- Ключи API (OpenAI, Facebook, Supabase)

---

## ✅ ЧЕКЛИСТ ПЕРЕД ДЕПЛОЕМ

- [ ] Код протестирован локально
- [ ] Все изменения закоммичены (`git status` чист)
- [ ] Запушено в `main` ветку
- [ ] На сервере выполнен `git pull`
- [ ] Пересобраны нужные контейнеры (`docker-compose build`)
- [ ] Контейнеры перезапущены (`docker-compose up -d`)
- [ ] Проверен статус контейнеров (`docker ps`)
- [ ] Проверены логи (`docker-compose logs -f`)
- [ ] Проверены оба домена в браузере
- [ ] Проверена работа API (`/api/health`)

---

## 📞 КОНТАКТЫ И ССЫЛКИ

**Домены:**
- Production Frontend: https://app.performanteaiagency.com
- App Review Frontend: https://performanteaiagency.com
- N8N Workflows: https://n8n.performanteaiagency.com
- Grafana (через SSH tunnel): http://localhost:3000
- Agent Brain (через SSH tunnel): http://localhost:7080

**Важные порты для SSH туннелей:**
- Grafana: `ssh -L 3000:localhost:3000 root@server`
- Agent Brain: `ssh -L 7080:localhost:7080 root@server`

---

## 📊 МОНИТОРИНГ И ЛОГИРОВАНИЕ

### **Стек мониторинга:**

```
Docker контейнеры (agent-brain, agent-service)
    ↓ (логи в JSON формате через Pino)
Promtail (сборщик логов)
    ↓ (отправка в Loki API)
Loki (хранилище логов)
    ↓ (запросы через LogQL)
Grafana (визуализация)
```

### **Компоненты:**

#### **1. Loki (порт 3100)**
- Хранилище логов (как Prometheus, но для логов)
- Индексирует по labels: `service`, `level`, `msg`, `userAccountName`, и т.д.
- Конфигурация: `logging/loki-config.yml`
- Volume: `loki-data` (хранит chunks и индексы)

#### **2. Promtail (порт 9080)**
- Собирает логи из Docker контейнеров
- Читает `/var/lib/docker/containers/*/*-json.log`
- Парсит двойной JSON: Docker обёртка + Pino JSON внутри
- Конфигурация: `logging/promtail-config.yml`

**Важные моменты:**
- ✅ Собирает логи от ВСЕХ контейнеров (не только с label `logging=promtail`)
- ✅ Автоматически парсит JSON поля: `level`, `service`, `msg`, `userAccountName`, и т.д.
- ✅ Использует `job=docker-logs` для совместимости с дашбордами Grafana
- ⚠️ Если Promtail падает - проверить конфигурацию pipeline_stages

#### **3. Grafana (порт 3000)**
- Визуализация логов и метрик
- Доступ: через SSH tunnel `ssh -L 3000:localhost:3000 root@server`
- Дашборды: `logging/grafana-provisioning/dashboards/`
  - `errors-by-user.json` - ошибки по пользователям
  - `agent-brain-drilldown.json` - детальный анализ agent-brain
  - `campaign-builder-errors.json` - ошибки campaign builder

**Datasource:**
- Loki: `http://loki:3100` (автоматически настроен через provisioning)

### **Полезные LogQL запросы:**

```logql
# Все ошибки от agent-brain
{service="agent-brain",level="error"}

# Ошибки конкретного пользователя
{userAccountName="performante",level="error"}

# Ошибки истечения Facebook токена
{msg="fb_token_expired"}

# Ошибки за последний час
{service="agent-service",level="error"}[1h]

# Подсчёт ошибок по типам
sum by (msg) (count_over_time({level="error"}[24h]))
```

### **Telegram алерты:**

Настроены в `agent-brain` через `logAlerts.js`:
- Опрашивает Loki каждые 30 секунд
- Дедупликация: 10 минут (не спамит одинаковыми ошибками)
- Фильтр критических ошибок: `fb_token_expired`, `fb_rate_limit`, `actions_dispatch_failed`, `supabase_unavailable`
- Эмодзи для разных типов ошибок: 🔑 (токен), ⏱️ (rate limit), 🗄️ (БД), и т.д.

**Переменные окружения** (в `.env.brain`):
```bash
LOG_ALERT_TELEGRAM_BOT_TOKEN=...
LOG_ALERT_TELEGRAM_CHAT_ID=...
LOKI_URL=http://loki:3100
LOG_ALERT_POLL_INTERVAL_MS=30000
LOG_ALERT_DEDUP_WINDOW_MS=600000
LOG_ALERT_CRITICAL_ONLY=true  # опционально
```

### **Диагностика проблем:**

**Promtail не собирает логи:**
```bash
# Проверить статус
docker-compose ps promtail

# Проверить логи
docker-compose logs promtail --tail 50

# Перезапустить
docker-compose restart promtail
```

**Loki не отвечает:**
```bash
# Проверить доступность
curl http://localhost:3100/ready

# Проверить labels
curl http://localhost:3100/loki/api/v1/labels

# Проверить логи
docker-compose logs loki --tail 50
```

**Grafana не показывает логи:**
```bash
# Проверить datasource в Grafana UI: Configuration → Data Sources → Loki
# URL должен быть: http://loki:3100

# Проверить что дашборды загружены
ls -la logging/grafana-provisioning/dashboards/

# Перезапустить Grafana
docker-compose restart grafana
```

---

## 📝 ИСТОРИЯ ИЗМЕНЕНИЙ

**20 ноября 2025:**
- ✅ **ФИКС:** Исправлена синхронизация продаж из AmoCRM
- ✅ Проблема: Ручная синхронизация лидов не обновляла данные о продажах (бюджет/статус сделки)
- ✅ Решение: В `syncCreativeLeadsFromAmoCRM` добавлена логика создания/обновления записей в таблице `sales` (аналогично вебхуку)
- ✅ Файл: `services/agent-service/src/workflows/amocrmLeadsSync.ts`

**8 ноября 2025:**
- ✅ **КРИТИЧЕСКИЙ ФИКС:** Решена проблема с отсутствием лидов из WhatsApp (Evolution API)
- ✅ Проблема: Лиды из WhatsApp перестали поступать в таблицу `leads` в течение последних суток
- ✅ Диагностика: `curl webhook/find` возвращал `null` - webhook не был настроен для инстанса
- ✅ Причина: Глобальный webhook в `docker-compose.yml` указывал НЕПРАВИЛЬНЫЙ URL с `/api` внутри Docker сети
- ✅ Было: `WEBHOOK_GLOBAL_URL=http://agent-service:8082/api/webhooks/evolution` ❌
- ✅ Стало: `WEBHOOK_GLOBAL_URL=http://agent-service:8082/webhooks/evolution` ✅
- ✅ Объяснение: Внутри Docker сети `/api` НЕ нужен (nginx убирает `/api` только для ВНЕШНИХ запросов)
- ✅ Решение: Исправлен `docker-compose.yml` + вручную настроен webhook для существующего инстанса
- ✅ Webhook команда: `curl -X POST webhook/set` с правильным URL через внешний домен (С `/api`)
- ✅ Файл: `docker-compose.yml` (строка 160) + документация
- ✅ Результат: Лиды снова поступают в таблицу `leads` ✅
- ✅ **ВАЖНО для новых инстансов:** Глобальный webhook теперь автоматически применяется ко всем новым инстансам

**6 ноября 2025:**
- ✅ **КРИТИЧЕСКИЙ ФИКС:** Решена проблема дублирования `/api/api/` в URL запросах
- ✅ Проблема: При локальной разработке и добавлении новых API сервисов постоянно возникала ошибка двойного `/api/api/`
- ✅ Причина: Несогласованность между `API_BASE_URL` (содержал `/api`) и API сервисами (добавляли `/api/` в пути)
- ✅ Решение: Установлен единый стандарт - `API_BASE_URL` ВСЕГДА содержит `/api`, сервисы НЕ добавляют `/api/`
- ✅ Исправлены все API сервисы (9 файлов): `directionsApi.ts`, `whatsappApi.ts`, `defaultSettingsApi.ts`, `manualLaunchApi.ts`, `DirectionAdSets.tsx`, `VideoUpload.tsx`, `Creatives.tsx`, `Header.tsx`, `FacebookConnect.tsx`
- ✅ Обновлена конфигурация: `config/api.ts`, `.env.local`, `Dockerfile`
- ✅ Создан документ `FRONTEND_API_CONVENTIONS.md` с правилами работы с API
- ✅ Добавлена интеграция `DirectionAdSets` компонента для управления pre-created ad sets
- ✅ Протестировано локально - все работает корректно
- ✅ **ВАЖНО:** Изменения полностью совместимы с production (nginx убирает `/api`, поэтому конечные URL не изменились)

**5 ноября 2025:**
- ✅ **ДОБАВЛЕН ДОМЕН:** `agent.performanteaiagency.com` для TikTok API proxy
- ✅ Проблема: Фронтенд не мог загружать данные из TikTok - обращался к несуществующему домену
- ✅ Обнаружен legacy сервис `/opt/tiktok-proxy/index.js` (порт 4001 на хосте)
- ✅ Добавлена конфигурация в `nginx-production.conf` для проксирования `/tproxy` → `http://172.17.0.1:4001/api/tiktok`
- ✅ Настроены CORS headers для кросс-доменных запросов
- ✅ Docker nginx теперь проксирует на сервис на хосте через IP `172.17.0.1` (Docker bridge)
- ✅ Файл: `nginx-production.conf` (новый server block)
- ✅ Коммит: `e5de3a1` - "feat: Add nginx config for agent.performanteaiagency.com TikTok proxy"
- ✅ Протестировано: endpoint отвечает HTTP/2 400 (нормально без параметров), CORS работает
- ✅ Документация: обновлены `TIKTOK_OAUTH_INTEGRATION.md` и `INFRASTRUCTURE.md`

**1 ноября 2025:**
- ✅ **КРИТИЧЕСКИЙ ФИКС:** Исправлена ошибка создания adsets в `Direction.CreateAdSetWithCreatives`
- ✅ Проблема: Facebook API возвращал "Invalid parameter" (error_subcode: 1870189)
- ✅ Причина: В targeting добавлялись лишние поля (`publisher_platforms`, `instagram_positions`, `device_platforms`, `targeting_automation.advantage_audience`)
- ✅ Решение: Убраны все лишние поля, targeting теперь используется КАК ЕСТЬ из `defaultSettings`
- ✅ Приведено в соответствие с рабочими workflows (auto-launch, manual-launch, creativeTest)
- ✅ Добавлено подробное логирование ошибок Facebook API в agent-brain (rate limits, invalid parameters)
- ✅ Файл: `services/agent-service/src/workflows/createAdSetInDirection.ts`
- ✅ Коммит: `3b82679` - "fix: Remove invalid targeting fields in CreateAdSetWithCreatives"
- ✅ Протестировано: adset успешно создан (ID: 120232923985510449)

**31 октября 2025:**
- ✅ Упрощена конфигурация Promtail (убран проблемный match stage)
- ✅ Promtail теперь собирает логи от всех контейнеров через static_configs
- ✅ Добавлена секция "Мониторинг и логирование" в INFRASTRUCTURE.md
- ✅ Удалены тестовые файлы (test-promtail-logs.sh, test-generate-errors.js)

**29 октября 2025:**
- ✅ Решена проблема с генерацией QR-кодов в Evolution API
- ✅ Обновлен Evolution API до v2.3.6 (Baileys 7.0.0-rc.6) путем сборки из исходников
- ✅ Создан отдельный поддомен evolution.performanteaiagency.com для Manager UI
- ✅ Исправлен SERVER_URL на правильный домен (https://evolution.performanteaiagency.com)
- ✅ Включены детальные логи Baileys (LOG_BAILEYS=debug) и WebSocket (WEBSOCKET_ENABLED=true)
- ✅ Отключен IPv6 для контейнера evolution-api для стабильности подключения
- ✅ Увеличены таймауты nginx для WebSocket до 3600s
- ✅ QR-коды теперь генерируются корректно через Manager UI и API

**28 октября 2025:**
- ✅ Добавлена интеграция Evolution API для WhatsApp Business
- ✅ Создана инфраструктура для работы с несколькими WhatsApp номерами
- ✅ Выполнены миграции БД (013-016) для поддержки direction_id, creative_id, WhatsApp instances
- ✅ Выполнены миграции БД (028-029) для поддержки pre-created ad sets:
  - 028: Добавлена колонка `default_adset_mode` ('api_create' | 'use_existing') в таблицу `user_accounts`
  - 029: Создана таблица `direction_adsets` для связи Facebook ad sets с directions
- ✅ Добавлены новые сервисы: evolution-api (порт 8080), evolution-postgres (5433), evolution-redis (6380)
- ✅ Обновлен nginx-production.conf с маршрутом /evolution/
- ✅ Добавлены роуты в agent-service: /api/webhooks/evolution, /api/whatsapp/instances
- ✅ Добавлены роуты для управления pre-created ad sets: `/api/directions/:id/adsets`, `/api/directions/:id/link-adset`, `/api/directions/:id/sync-adsets`
- ✅ Добавлен новый action в AgentBrain: `Direction.UseExistingAdSetWithCreatives` для работы с pre-created ad sets

**25 октября 2025:**
- ✅ Добавлен Python 3.12.12 + Pillow 11.0.0 в n8n контейнер
- ✅ Обновлен `/root/Dockerfile` с полным набором зависимостей для работы с изображениями
- ✅ Исправлена WebSocket конфигурация в nginx (добавлен `map $http_upgrade`)
- ✅ Решена проблема с Docker сетями (n8n подключен к `agents-monorepo_default`)
- ✅ Добавлена документация по n8n в INFRASTRUCTURE.md
- ✅ Создан отчет N8N_PYTHON_PILLOW_SETUP_REPORT.md

**23 октября 2025:**
- ✅ Исправлен конфликт портов (системный nginx vs Docker nginx)
- ✅ Подтверждена работа обеих версий фронтенда
- ✅ Создана эта документация

**22 октября 2025:**
- Попытка миграции на subdomain (незавершенная)
- Создан `app.conf` для системного nginx (больше не используется)

---

**ВАЖНО:** Всегда проверяй эту документацию перед деплоем! При изменении архитектуры - обновляй этот файл!

🚀 **Успешного деплоя!**

